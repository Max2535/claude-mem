import { test, expect, Page } from '@playwright/test';

/**
 * Token Burn against the live worker. Numbers are never asserted — the machine
 * running this may have spent nothing yet, and a fresh install legitimately
 * shows an empty chart. What is asserted is that the screen renders, the
 * controls work, and the coverage gaps are stated rather than implied.
 */

async function openBurn(page: Page) {
  await page.goto('/#/burn');
  await page.locator('.page-title', { hasText: 'Token Burn' }).waitFor();
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.get('/api/token-burn').catch(() => null);
  test.skip(!response?.ok(), 'viewer worker is not running on the configured port');
  await page.addInitScript(() => {
    try { localStorage.setItem('claude-mem-welcome-dismissed-v3', 'true'); } catch { /* private mode */ }
  });
});

test('the sidebar reaches Token Burn and it renders a real screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav-item', { hasText: 'Token Burn' }).click();

  await expect(page.locator('.page-title')).toHaveText('Token Burn');
  await expect(page).toHaveURL(/#\/burn$/);
  // A built destination must never fall through to the ComingSoon panel.
  await expect(page.locator('.coming-soon')).toHaveCount(0);
});

test('shows the four KPI tiles', async ({ page }) => {
  await openBurn(page);
  await expect(page.locator('.stat-tile')).toHaveCount(4);
  await expect(page.locator('.stat-tile-label')).toContainText([
    'claude-mem burn', 'Your sessions', 'Overhead', 'Cache reads',
  ]);
});

test('draws two series, or says plainly that there is nothing to draw', async ({ page }) => {
  await openBurn(page);
  const plot = page.locator('.chart-plot');
  const empty = page.locator('.chart-empty');
  await expect(plot.or(empty).first()).toBeVisible();

  if (await plot.count() > 0) {
    await expect(page.locator('.burn-series-line')).toHaveCount(2);
    // Identity must not rest on colour alone.
    await expect(page.locator('.burn-label')).toHaveCount(2);
  }
});

test('the window and metric toggles both take effect', async ({ page }) => {
  await openBurn(page);

  await page.locator('.chart-range-btn', { hasText: '7d' }).click();
  await expect(page.locator('.chart-range-btn.is-active', { hasText: '7d' })).toBeVisible();

  await page.locator('.chart-range-btn', { hasText: 'With cache reads' }).click();
  await expect(page.locator('.chart-subtitle').first()).toContainText('cache reads');
});

// Every gap in this feature is disclosed on the page rather than left to be
// mistaken for a zero.
test('states its coverage gaps on the page', async ({ page }) => {
  await openBurn(page);
  const notes = page.locator('.burn-note li');
  await expect(notes.first()).toBeVisible();
  await expect(notes).toContainText([/price/i]);
});
