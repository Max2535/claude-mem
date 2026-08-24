import { test, expect, Page } from '@playwright/test';

/**
 * The Digest and Activity tabs read the same day the Tree draws, from the same
 * /api/explorer/day payload. These assert that agreement and the shape of each
 * tab — never a count, which a new observation would change.
 */

async function openExplorer(page: Page) {
  await page.goto('/#/explorer');
  await page.locator('.tree-node-day').waitFor();
}

async function openTab(page: Page, name: 'Tree' | 'Digest' | 'Activity') {
  await page.getByRole('tab', { name }).click();
}

/**
 * A quiet day can hold one type, one project and one source — nothing to break
 * down. Step back until a day has a dimension worth comparing.
 */
async function openDigestWithBreakdown(page: Page) {
  await openExplorer(page);
  await openTab(page, 'Digest');
  const previous = page.getByRole('button', { name: 'Previous day' });
  for (let step = 0; step < 12; step += 1) {
    if (await page.locator('.digest-breakdown').count() > 0) return;
    if (await previous.isDisabled()) break;
    await previous.click();
    await page.locator('.stat-tile').first().waitFor();
  }
  test.skip(
    await page.locator('.digest-breakdown').count() === 0,
    'no recorded day has a dimension with more than one value'
  );
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.get('/api/explorer/day').catch(() => null);
  test.skip(!response?.ok(), 'viewer worker is not running on the configured port');
  await page.addInitScript(() => {
    try { localStorage.setItem('claude-mem-welcome-dismissed-v3', 'true'); } catch { /* private mode */ }
  });
});

test('all three tabs are reachable and none says it is unbuilt', async ({ page }) => {
  await openExplorer(page);

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Tree', 'Digest', 'Activity']);
  await expect(page.locator('.explorer-tab:disabled')).toHaveCount(0);

  await openTab(page, 'Digest');
  await expect(page.locator('.stat-tile')).toHaveCount(4);
  await expect(page.locator('.tree-graph')).toHaveCount(0);

  await openTab(page, 'Activity');
  await expect(page.locator('.chart-plot, .chart-empty')).toHaveCount(1);
  await expect(page.locator('.stat-tile')).toHaveCount(0);

  await openTab(page, 'Tree');
  await expect(page.locator('.tree-graph')).toHaveCount(1);
});

test('the digest counts exactly the rows the day payload carries', async ({ page }) => {
  // Against the payload rather than against unfolded leaves: both surfaces
  // read this one response, and unfolding the whole tree to count dots is a
  // slow way of asking the same question.
  const payload = await (await page.request.get('/api/explorer/day')).json() as { observations: unknown[] };
  test.skip(payload.observations.length === 0, 'the landing day has no observations to compare');

  await openExplorer(page);
  await openTab(page, 'Digest');

  const total = await page.locator('.stat-tile').first().locator('.stat-tile-value').textContent();
  expect(Number(total)).toBe(payload.observations.length);
});

test('a breakdown adds up to the total and reads biggest first', async ({ page }) => {
  await openDigestWithBreakdown(page);

  const total = Number(await page.locator('.stat-tile').first().locator('.stat-tile-value').textContent());
  const sections = page.locator('.digest-breakdown');
  const count = await sections.count();

  for (let i = 0; i < count; i += 1) {
    const counts = (await sections.nth(i).locator('.digest-row-count').allTextContents()).map(Number);
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(total);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  }
});

test('no breakdown is ever drawn as a single full-width bar', async ({ page }) => {
  await openExplorer(page);
  await openTab(page, 'Digest');

  const sections = page.locator('.digest-breakdown');
  for (let i = 0; i < await sections.count(); i += 1) {
    expect(await sections.nth(i).locator('.digest-row').count()).toBeGreaterThan(1);
  }
});

test('the fourth tile never restates the third', async ({ page }) => {
  await openExplorer(page);
  await openTab(page, 'Digest');

  const values = await page.locator('.stat-tile-value').allTextContents();
  expect(values).toHaveLength(4);
  expect(values[3]).not.toBe(values[2]);
});

test('the activity lanes are labelled by observation type, in a fixed order', async ({ page }) => {
  await openExplorer(page);
  await openTab(page, 'Activity');

  const labels = await page.locator('.chart-lane-label').allTextContents();
  test.skip(labels.length === 0, 'the landing day has nothing to plot');

  const ORDER = ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change'];
  const ranks = labels.map(label => (ORDER.indexOf(label) === -1 ? ORDER.length : ORDER.indexOf(label)));
  expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  // Every mark is an observation, so no lane is painted a second hue.
  await expect(page.locator('.chart-dot:not(.chart-dot-observation)')).toHaveCount(0);
});

test('the grouping controls are hidden on the tabs that cannot use them', async ({ page }) => {
  await openExplorer(page);
  await expect(page.getByRole('group', { name: 'Group by' })).toBeVisible();

  for (const tab of ['Digest', 'Activity'] as const) {
    await openTab(page, tab);
    await expect(page.getByRole('group', { name: 'Group by' })).toHaveCount(0);
    // The day stepper stays: all three tabs read one day at a time.
    await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible();
  }
});

test('stepping the day on one tab carries to the others', async ({ page }) => {
  await openExplorer(page);
  const previous = page.getByRole('button', { name: 'Previous day' });
  test.skip(await previous.isDisabled(), 'only one day is recorded');

  await openTab(page, 'Digest');
  const first = await page.locator('.explorer-stepper-value').first().textContent();
  await previous.click();
  await expect(page.locator('.explorer-stepper-value').first()).not.toHaveText(first ?? '');

  const stepped = await page.locator('.explorer-stepper-value').first().textContent();
  await openTab(page, 'Tree');
  await expect(page.locator('.explorer-stepper-value').first()).toHaveText(stepped ?? '');
});

test('no time-range button is offered that cannot narrow the view', async ({ page }) => {
  await openExplorer(page);
  await openTab(page, 'Activity');

  const subtitle = await page.locator('.chart-subtitle').textContent();
  test.skip(!subtitle?.includes('–'), 'this day has nothing to plot');

  const buttons = await page.locator('.chart-range-btn').allTextContents();
  // Whatever survives, "All" is always among them and the row is never a
  // single button pretending to be a choice.
  if (buttons.length > 0) {
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons).toContain('All');
    // A day of work is under 24 hours, so the wide windows must be gone.
    expect(buttons).not.toContain('7d');
  }
  await expect(page.locator('.chart-range-btn.is-active')).toHaveCount(buttons.length > 0 ? 1 : 0);
});
