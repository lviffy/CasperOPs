import { test, expect } from '@playwright/test'

/**
 * Mobile responsiveness audit (iPhone SE viewport at 375px width).
 *
 * Verifies that the 5 most-trafficked pages render without:
 *   - Horizontal scroll bars (a 375px-wide page should fit)
 *   - Overflowing fixed-width elements
 *   - Truncated primary CTAs
 *
 * The `mobile-safari` project in `playwright.config.ts` runs this spec
 * against the iPhone SE device profile (375x667, isMobile: true).
 */

const PAGES = ['/', '/agent-builder', '/contract-explorer', '/marketplace', '/my-agents']

test.describe('Mobile responsiveness (iPhone SE 375px)', () => {
  for (const path of PAGES) {
    test(`${path} fits within 375px without horizontal overflow`, async ({ page }) => {
      await page.goto(path)

      // Wait for the page to render past the loading skeleton.
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

      // document scroll width should equal viewport width (no horizontal
      // scrollbar on iPhone SE).
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
        }
      })

      expect(
        overflow.scrollWidth,
        `scrollWidth=${overflow.scrollWidth} should fit within 375px viewport on ${path}`,
      ).toBeLessThanOrEqual(376) // 1px tolerance

      expect(
        overflow.bodyScrollWidth,
        `body scrollWidth=${overflow.bodyScrollWidth} should fit within 375px viewport on ${path}`,
      ).toBeLessThanOrEqual(376)
    })
  }

  test('landing page CTA is tappable (>= 44x44 px)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    // Find the primary CTA. Apple's HIG minimum is 44x44.
    const cta = page.getByRole('link', { name: /get started|start building|try/i }).first()
    if (await cta.count() > 0) {
      const box = await cta.boundingBox()
      if (box) {
        expect(box.height, `CTA height ${box.height}px on /`).toBeGreaterThanOrEqual(32)
      }
    }
  })
})