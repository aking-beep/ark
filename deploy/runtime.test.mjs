import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("three-product docker runtime", () => {
  test("Dockerfile installs Python 3.12+, AI Fit engine, and exposes 8472", () => {
    const docker = read("deploy/Dockerfile");
    assert.match(docker, /FROM python:3\.12/);
    assert.match(docker, /pip3 install .* -e \.\/my-ai/);
    assert.match(docker, /COPY my-ai \.\/my-ai/);
    assert.match(docker, /MYAI_ROOT=\/app\/my-ai/);
    assert.match(docker, /API_ORIGIN=http:\/\/127\.0\.0\.1:8472/);
    assert.match(docker, /EXPOSE 3000 3001 3002 8472/);
    assert.doesNotMatch(docker, /NEXT_PUBLIC_ARK_BUSINESS_URL/);
    assert.match(docker, /curl[\s\S]*--max-time/);
  });

  test("entrypoint starts AI Fit API with the three Next apps", () => {
    const entry = read("deploy/entrypoint.sh");
    assert.match(entry, /my-ai-api,consumer,business,control/);
    assert.match(entry, /cd \/app\/my-ai/);
    assert.match(entry, /uvicorn services\.api\.main:app/);
    assert.match(entry, /--port 8472/);
    assert.match(entry, /--host 0\.0\.0\.0/);
  });

  test("compose publishes 8472 on loopback only and API_ORIGIN, not Fit↔business URLs", () => {
    const compose = read("deploy/docker-compose.yml");
    assert.match(compose, /"127\.0\.0\.1:8472:8472"/);
    assert.match(compose, /API_ORIGIN: http:\/\/127\.0\.0\.1:8472/);
    assert.match(compose, /MYAI_ROOT: \/app\/my-ai/);
    assert.doesNotMatch(compose, /ARK_CONSUMER_URL:/);
    assert.doesNotMatch(compose, /NEXT_PUBLIC_ARK_BUSINESS_URL:/);
  });
});

describe("deploy hardening", () => {
  test("entrypoint bootstraps every boot instead of testing for a local file", () => {
    const entry = read("deploy/entrypoint.sh");
    // A file check re-seeds a remote libSQL DB on every replica boot.
    assert.doesNotMatch(entry, /-f \/data\/ark\.db/);
    assert.doesNotMatch(entry, /db:seed/);
    assert.match(entry, /npm run db:bootstrap/);
    assert.match(entry, /concurrently --kill-others-on-fail/);
  });

  test("compose requires a session secret and real seed credentials", () => {
    const compose = read("deploy/docker-compose.yml");
    assert.doesNotMatch(compose, /change-me-in-production/);
    assert.doesNotMatch(compose, /ark_dev_ingest_org_demo/);
    assert.match(compose, /ARK_SESSION_SECRET: \$\{ARK_SESSION_SECRET:\?/);
    for (const v of [
      "ARK_DEMO_PASSWORD",
      "ARK_NORTHWIND_PASSWORD",
      "ARK_INGEST_TOKEN_DEMO",
      "ARK_INGEST_TOKEN_NORTHWIND",
    ]) {
      assert.match(compose, new RegExp(`${v}: \\$\\{${v}:\\?`), v);
    }
    assert.match(compose, /ARK_DATABASE_URL: \$\{ARK_DATABASE_URL:-file:\/data\/ark\.db\}/);
    assert.match(compose, /ARK_DATABASE_AUTH_TOKEN:/);
    assert.match(compose, /ARK_CONTROL_TOKEN: \$\{ARK_CONTROL_TOKEN:-\$\{ARK_INGEST_TOKEN_DEMO\}\}/);
    for (const v of ["ARK_SHOW_DEMO_LOGIN", "ARK_MEASURE_ENABLED", "ARK_ALLOW_SEED"]) {
      assert.match(compose, new RegExp(`${v}:`), v);
    }
    assert.match(compose, /restart: unless-stopped/);
    assert.match(compose, /healthcheck:/);
  });

  test("Dockerfile picks the node build for the target arch and drops root", () => {
    const docker = read("deploy/Dockerfile");
    assert.match(docker, /ARG TARGETARCH/);
    assert.match(docker, /linux-\$\{NODE_ARCH\}/);
    assert.doesNotMatch(docker, /linux-x64\.tar/);
    assert.match(docker, /^USER ark$/m);
    assert.match(docker, /chown -R ark:ark \/app \/data/);
    assert.match(docker, /^HEALTHCHECK /m);
    assert.ok(existsSync(join(root, "deploy/healthcheck.sh")));
  });

  test("secrets stay out of the image and the repo", () => {
    const dockerignore = read(".dockerignore").split("\n");
    const gitignore = read(".gitignore").split("\n");
    for (const lines of [dockerignore, gitignore]) {
      assert.ok(lines.some((l) => /^(\*\*\/)?\.env\*$/.test(l)));
      // Negation must come after the exclude or it is overridden.
      const neg = lines.indexOf("!.env.example");
      const exc = lines.findIndex((l) => /^(\*\*\/)?\.env\*$/.test(l));
      assert.ok(neg > exc, "!.env.example must follow .env*");
    }
    for (const p of ["**/.venv", "**/__pycache__", "**/playwright-report", "**/test-results", "**/coverage"]) {
      assert.ok(dockerignore.includes(p), p);
    }
  });

  test("root package exposes db:bootstrap and requires a node with strip-types", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.engines.node, ">=22.6");
    assert.equal(pkg.scripts["db:bootstrap"], "npm run bootstrap --workspace @ark/db");
    assert.match(pkg.scripts.test, /npm run test:control/);
    assert.match(pkg.scripts.typecheck, /typecheck:scripts/);
  });

  test("workflows default to read-only tokens", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/refresh-models.yml"]) {
      assert.match(read(f), /^permissions:\n  contents: read$/m, f);
    }
    assert.doesNotMatch(read(".github/workflows/refresh-models.yml"), /node-version: '20'/);
  });
});

describe("AI Fit and AI Fit Teams stay separate products", () => {
  test("consumer chrome brands as AI Fit and does not link to teams", () => {
    const header = read("apps/consumer/src/components/site-header.tsx");
    const landing = read("apps/consumer/src/app/page.tsx");
    const layout = read("apps/consumer/src/app/layout.tsx");
    const results = read("apps/consumer/src/components/results-view.tsx");
    assert.match(header, /AI Fit/);
    assert.match(landing, /Find AI Fit/);
    assert.match(layout, /applicationName: "AI Fit"/);
    assert.match(results, /AI Fit score/);
    assert.doesNotMatch(landing, /Find my fit/);
    assert.doesNotMatch(results, /(?<!AI )Fit score/);
    assert.doesNotMatch(header, /For teams/);
    assert.doesNotMatch(header, /businessUrl/);
    assert.doesNotMatch(landing, /AIFit for teams/);
    assert.doesNotMatch(landing, /AI Fit Teams/);
    assert.equal(existsSync(join(root, "apps/consumer/src/lib/ark-links.ts")), false);
  });

  test("business chrome brands as AI Fit Teams and does not funnel into consumer", () => {
    const layout = read("apps/business/src/app/layout.tsx");
    const page = read("apps/business/src/app/page.tsx");
    assert.match(layout, /AI Fit Teams/);
    assert.match(page, /AI Fit Teams/);
    assert.doesNotMatch(layout, /AIFit/);
    assert.doesNotMatch(page, /AIFit/);
    assert.doesNotMatch(page, /six questions/);
    assert.doesNotMatch(page, /Not at work/);
    assert.doesNotMatch(page, /Open Fit/);
    assert.doesNotMatch(page, /ARK_CONSUMER_URL/);
  });

  test("control user-visible copy names AI Fit Teams, not AIFit", () => {
    const dashboard = read("apps/control/src/app/dashboard/page.tsx");
    const calibration = read("apps/control/src/app/calibration/page.tsx");
    const workload = read("apps/control/src/app/workloads/[id]/page.tsx");
    for (const src of [dashboard, calibration, workload]) {
      assert.match(src, /AI Fit Teams/);
      assert.doesNotMatch(src, /AIFit/);
    }
  });

  test("consumer does not depend on @ark/db or @ark/core", () => {
    const pkg = JSON.parse(read("apps/consumer/package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!deps["@ark/db"]);
    assert.ok(!deps["@ark/core"]);
  });

  test("consumer engine lives in my-ai/ as the myai package", () => {
    assert.equal(existsSync(join(root, "fit")), false);
    assert.equal(existsSync(join(root, "apps/consumer/src/lib/fit-proxy.ts")), false);
    assert.ok(existsSync(join(root, "my-ai/pyproject.toml")));
    assert.ok(existsSync(join(root, "my-ai/packages/core/src/myai/engine.py")));
    assert.ok(existsSync(join(root, "apps/consumer/src/lib/my-ai-proxy.ts")));
    const pyproject = read("my-ai/pyproject.toml");
    assert.match(pyproject, /name = "myai"/);
    const proxy = read("apps/consumer/src/lib/my-ai-proxy.ts");
    assert.match(proxy, /AI Fit API is not configured/);
    assert.doesNotMatch(proxy, /(?<!AI )Fit API/);
  });
});
