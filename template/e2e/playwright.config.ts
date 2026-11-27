import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  retries: 0,
  workers: 1,
  timeout: 30_000,
  forbidOnly: true,
  reporter: [["json", { outputFile: "results.json" }]],
  use: { baseURL: process.env.BASE_URL },
});
