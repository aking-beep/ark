import { defineConfig, devices } from "@playwright/test";

const web = "http://127.0.0.1:43123";

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
      cwd: "../..",
      url: "http://127.0.0.1:8472/health",
      reuseExistingServer: true,
    },
    {
      command: "npm run start",
      url: web,
      reuseExistingServer: true,
    },
  ],
});
