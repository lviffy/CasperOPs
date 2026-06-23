import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility audit (axe-core) for the 5 most-trafficked pages.
 *
 * Axe-core runs the WCAG 2.1 AA rule set by default. We fail on
 * `critical` or `serious` violations; `moderate` and `minor` are
 * reported but don't fail the test so we can iterate on the backlog
 * without blocking merges.
 */

const PAGES = [
  { path: '/', name: 'Landing' },
  { path: '/agent-builder', name: 'Agent Builder' },
  { path: '/contract-explorer', name: 'Contract Explorer' },
  { path: '/marketplace', name: 'Marketplace' },
  { path: '/my-agents', name: 'My Agents' },
]

test.describe('Accessibility (WCAG 2.1 AA)', () => {
  for (const { path, name } of PAGES) {
    test(`${name} (${path}) has no critical/serious axe violations`, async ({ page }) => {
      await page.goto(path)

      // Wait for the page to settle past the loading skeleton.
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      // Give React a tick to commit the final render.
      await page.waitForTimeout(500)

      const accessibilityScanResults = await new AxeBuilder({ page })
        // WCAG 2.1 Level A + AA (the default; explicit for clarity).
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const blocking = accessibilityScanResults.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      )

      // Pretty-print every blocking violation so the failure log is
      // actionable without re-running.
      if (blocking.length) {
        const summary = blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          sample: v.nodes[0]?.html?.slice(0, 120),
          target: v.nodes[0]?.target,
        }))
        console.error(`\nAxe violations on ${path}:`, JSON.stringify(summary, null, 2))
      }

      expect(
        blocking,
        `${path} has ${blocking.length} critical/serious axe violations`,
      ).toEqual([])
    })
  }
})