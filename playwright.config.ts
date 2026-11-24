import { defineConfig, devices } from "@playwright/test";

// Secrets for the live tests' Supabase checks (same file the dev server reads).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: mocked tests still run
}

// E2E_BASE_URL lets the same tests run against the deployed Vercel URL.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // One worker, in order: the free model allows ~5 requests/min, and live tests share one database.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // Fast, no LLM calls: /api/onboarding is mocked.
    { name: "mocked", testMatch: /.*\.mocked\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // Real backend, Firecrawl and model. Paced; run with `npm run test:e2e:live`.
    { name: "live", testMatch: /.*\.live\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
