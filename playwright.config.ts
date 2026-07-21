import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localWebServer = {
  command: "bun run preview",
  port: 4173,
  reuseExistingServer: true,
};

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: externalBaseURL ?? "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  ...(externalBaseURL ? {} : { webServer: localWebServer }),
});
