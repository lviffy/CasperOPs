import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config for the CasperOPs frontend E2E suite (Phase 25).
 *
 * Run modes:
 *   npm run test:e2e              # both chromium + webkit against `npm run start`
 *   npm run test:e2e:chromium     # chromium only (CI default — faster)
 *   npm run test:e2e:ui           # interactive UI for local dev
 *
 * Base URL can be overridden via PLAYWRIGHT_BASE_URL when running against
 * a Vercel preview deploy (see .github/workflows/ci.yml → `e2e` job).
 *
 * The webServer block boots `next start` automatically when nothing is
 * listening on port 3000, so contributors can run `npm run test:e2e`
 * without spinning anything up first. CI sets `PLAYWRIGHT_BASE_URL` to
 * skip the local boot.
 */

const PORT = Number(process.env.PORT || 3000)
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false'

export default defineConfig({
  testDir: "./e2e",
  // Each spec gets up to 60s — wallet connect, drag-drop, RPC polling
  // all need real time. Traces + videos capture failures.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Mirror the most common mobile viewport for responsive checks.
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The responsive audit is mobile-specific; let the
      // mobile-chromium project own it.
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      // iPhone-SE-equivalent viewport on chromium — avoids pulling in
      // webkit which requires system libs Playwright can't auto-install
      // in CI sandboxes without sudo apt-get install.
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})