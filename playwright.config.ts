import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (`next build` first).
 *
 * They run against the Supabase project in .env.local and use the three
 * seeded test accounts. Anything they book is marked "automated test".
 * Chromium's fake camera stands in for the phone camera.
 */
process.loadEnvFile(".env.local");

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }], ["json", { outputFile: "e2e-report/results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["iPhone 13"],
    // iPhone viewport and touch, but Chromium: WebKit has no fake camera.
    browserName: "chromium",
    defaultBrowserType: "chromium",
    permissions: ["camera", "geolocation"],
    geolocation: { latitude: 17.4401, longitude: 78.3489, accuracy: 10 },
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
