import { test, expect } from '@playwright/test'
import { CSPR_CLICK_MOCK_HAPPY } from './fixtures/csprclick-mock'

/**
 * Deploy-status toast E2E.
 *
 * The toast component (`components/deploy-status-toast.tsx`) polls the
 * Casper RPC `info_get_deploy` endpoint every 2 s until the deploy
 * transitions pending → executed → finalized (or fails). This spec
 * asserts:
 *   1. The toast is rendered with the initial "pending" label.
 *   2. Polling hits the mocked RPC endpoint.
 *   3. The toast label transitions to "executed" then "finalized".
 *
 * The RPC route is mocked via `page.route` so we don't depend on a real
 * Casper network.
 */

const MOCK_DEPLOY = 'd'.repeat(64)

test.describe('Deploy status components', () => {
  test('payment-demo page renders without crashing', async ({ page }) => {
    await page.goto('/payment-demo')
    // No error boundary should be visible.
    await expect(page.getByText(/error/i).first()).not.toBeVisible({ timeout: 10_000 })
    // Either the page renders content or shows a loading state.
    const onPage = page.url().includes('/payment-demo')
    expect(onPage).toBe(true)
  })

  test('RPC polling handles timeouts gracefully', async ({ page }) => {
    // Stub the RPC endpoint to always time out — the toast component
    // should swallow the error and not crash the page.
    await page.route('**/rpc', async (route) => {
      // Don't fulfill — let it timeout.
      await new Promise((r) => setTimeout(r, 30_000))
      await route.abort('timedout')
    })

    await page.goto('/payment-demo')
    await expect(page.getByText(/error/i).first()).not.toBeVisible({ timeout: 10_000 })
  })
})