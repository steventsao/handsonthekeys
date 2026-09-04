import { defineConfig, devices } from "@playwright/test"

const remoteBaseUrl = (
  globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }
).process?.env?.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: remoteBaseUrl ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  ...(remoteBaseUrl === undefined
    ? {
        webServer: {
          command: "pnpm dev --host 127.0.0.1 --port 4173",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: true,
          timeout: 120_000
        }
      }
    : {})
})
