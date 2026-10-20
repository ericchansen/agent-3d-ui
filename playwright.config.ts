import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  use: { baseURL: process.env.UI_URL ?? "http://127.0.0.1:3100", channel: "msedge", screenshot: "only-on-failure" },
  workers: 1,
});
