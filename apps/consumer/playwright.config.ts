import { defineConfig, devices } from "@playwright/test";

const webPort = 43123;
const web = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: web,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      testMatch: /mobile-release/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command:
        "PYTHONPATH=packages/core/src python3 -m uvicorn services.api.main:app --host 127.0.0.1 --port 8472",
      // The API and its core package live under my-ai/ in the monorepo.
      cwd: "../../my-ai",
      url: "http://127.0.0.1:8472/health",
      reuseExistingServer: true,
    },
    {
      // `npm run start` binds :3000; serve the production build (`npm run build` first) on the port we wait for.
      command: `npx next start --hostname 127.0.0.1 --port ${webPort}`,
      env: { API_ORIGIN: "http://127.0.0.1:8472" },
      url: web,
      reuseExistingServer: true,
    },
  ],
});
