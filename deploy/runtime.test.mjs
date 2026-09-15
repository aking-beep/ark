import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    assert.match(docker, /NEXT_PUBLIC_ARK_BUSINESS_URL/);
  });

  test("entrypoint starts Fit API with the three Next apps", () => {
    const entry = read("deploy/entrypoint.sh");
    assert.match(entry, /fit-api,consumer,business,control/);
    assert.match(entry, /uvicorn services\.api\.main:app/);
    assert.match(entry, /--port 8472/);
    assert.match(entry, /--host 0\.0\.0\.0/);
  });

  test("compose publishes 8472 and sets API_ORIGIN plus cross-link URLs", () => {
    const compose = read("deploy/docker-compose.yml");
    assert.match(compose, /"8472:8472"/);
    assert.match(compose, /API_ORIGIN: http:\/\/127\.0\.0\.1:8472/);
    assert.match(compose, /ARK_CONSUMER_URL:/);
    assert.match(compose, /NEXT_PUBLIC_ARK_BUSINESS_URL:/);
  });
});

describe("three-product cross-links", () => {
  test("Fit chrome and landing point at AIFit for teams", () => {
    const header = read("apps/consumer/src/components/site-header.tsx");
    const landing = read("apps/consumer/src/app/page.tsx");
    const links = read("apps/consumer/src/lib/ark-links.ts");
    assert.match(header, /For teams/);
    assert.match(header, /businessUrl/);
    assert.match(landing, /AIFit for teams/);
    assert.match(links, /NEXT_PUBLIC_ARK_BUSINESS_URL/);
    assert.match(links, /localhost:3001/);
  });

  test("business landing describes Fit, not six questions", () => {
    const page = read("apps/business/src/app/page.tsx");
    assert.doesNotMatch(page, /six questions/);
    assert.match(page, /five-minute personal quiz/);
    assert.match(page, /Open Fit/);
    assert.match(page, /ARK_CONSUMER_URL/);
  });

  test("consumer does not depend on @ark/db or @ark/core", () => {
    const pkg = JSON.parse(read("apps/consumer/package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!deps["@ark/db"]);
    assert.ok(!deps["@ark/core"]);
  });
});
