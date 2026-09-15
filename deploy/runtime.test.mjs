import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("three-product docker runtime", () => {
  test("Dockerfile installs Python 3.12+, Fit, and exposes 8472", () => {
    const docker = read("deploy/Dockerfile");
    assert.match(docker, /FROM python:3\.12/);
    assert.match(docker, /pip3 install .* -e \.\/fit/);
    assert.match(docker, /COPY fit \.\/fit/);
    assert.match(docker, /API_ORIGIN=http:\/\/127\.0\.0\.1:8472/);
    assert.match(docker, /EXPOSE 3000 3001 3002 8472/);
    assert.doesNotMatch(docker, /NEXT_PUBLIC_ARK_BUSINESS_URL/);
    assert.match(docker, /curl[\s\S]*--max-time/);
  });

  test("entrypoint starts Fit API with the three Next apps", () => {
    const entry = read("deploy/entrypoint.sh");
    assert.match(entry, /fit-api,consumer,business,control/);
    assert.match(entry, /uvicorn services\.api\.main:app/);
    assert.match(entry, /--port 8472/);
    assert.match(entry, /--host 0\.0\.0\.0/);
  });

  test("compose publishes 8472 and API_ORIGIN, not Fit↔business URLs", () => {
    const compose = read("deploy/docker-compose.yml");
    assert.match(compose, /"8472:8472"/);
    assert.match(compose, /API_ORIGIN: http:\/\/127\.0\.0\.1:8472/);
    assert.doesNotMatch(compose, /ARK_CONSUMER_URL:/);
    assert.doesNotMatch(compose, /NEXT_PUBLIC_ARK_BUSINESS_URL:/);
  });
});

describe("MY AI and MY AI for teams stay separate products", () => {
  test("consumer chrome brands as MY AI and does not link to teams", () => {
    const header = read("apps/consumer/src/components/site-header.tsx");
    const landing = read("apps/consumer/src/app/page.tsx");
    const layout = read("apps/consumer/src/app/layout.tsx");
    const results = read("apps/consumer/src/components/results-view.tsx");
    assert.match(header, /MY AI/);
    assert.match(landing, /Find MY AI/);
    assert.match(layout, /applicationName: "MY AI"/);
    assert.match(results, /MY AI score/);
    assert.doesNotMatch(landing, /Find my fit/);
    assert.doesNotMatch(results, /Fit score/);
    assert.doesNotMatch(header, /For teams/);
    assert.doesNotMatch(header, /businessUrl/);
    assert.doesNotMatch(landing, /AIFit for teams/);
    assert.doesNotMatch(landing, /MY AI for teams/);
    assert.equal(existsSync(join(root, "apps/consumer/src/lib/ark-links.ts")), false);
  });

  test("business chrome brands as MY AI for teams and does not funnel into consumer", () => {
    const layout = read("apps/business/src/app/layout.tsx");
    const page = read("apps/business/src/app/page.tsx");
    assert.match(layout, /MY AI for teams/);
    assert.match(page, /MY AI for teams/);
    assert.doesNotMatch(layout, /AIFit/);
    assert.doesNotMatch(page, /AIFit/);
    assert.doesNotMatch(page, /six questions/);
    assert.doesNotMatch(page, /Not at work/);
    assert.doesNotMatch(page, /Open Fit/);
    assert.doesNotMatch(page, /ARK_CONSUMER_URL/);
  });

  test("control user-visible copy names MY AI for teams, not AIFit", () => {
    const dashboard = read("apps/control/src/app/dashboard/page.tsx");
    const calibration = read("apps/control/src/app/calibration/page.tsx");
    const workload = read("apps/control/src/app/workloads/[id]/page.tsx");
    for (const src of [dashboard, calibration, workload]) {
      assert.match(src, /MY AI for teams/);
      assert.doesNotMatch(src, /AIFit/);
    }
  });

  test("consumer does not depend on @ark/db or @ark/core", () => {
    const pkg = JSON.parse(read("apps/consumer/package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!deps["@ark/db"]);
    assert.ok(!deps["@ark/core"]);
  });
});
