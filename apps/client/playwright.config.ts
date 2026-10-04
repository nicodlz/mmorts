import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3010",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: [
    {
      command: "pnpm --filter server exec ts-node test/browser-server.ts",
      cwd: "../..",
      port: 2577,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "pnpm exec vite --port 3010",
      port: 3010,
      env: { VITE_SERVER_URL: "http://127.0.0.1:2577", VITE_E2E: "true" },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
