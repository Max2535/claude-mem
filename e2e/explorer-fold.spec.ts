import { test, expect, Page } from '@playwright/test';

/**
 * The Explorer tree folds to the prompt tier so a whole day reads at once.
 *
 * These run against the live worker and therefore against a database that
 * keeps growing while claude-mem records. Every assertion here is about the
 * shape of the tree — what folds, what opens, who owns the scroll — never
 * about a count that a new observation would change. The exact numbers for a
 * fixed set of rows are covered by tests/viewer/explorer-hierarchy.test.ts.
 */

/** Mirrors MIN_COL_GAP / MAX_COL_GAP in src/ui/viewer/components/TreeGraph.tsx. */
const MIN_COL_GAP = 13;
const MAX_COL_GAP = 34;

async function openExplorer(page: Page, hash = '#/explorer') {
  await page.goto(`/${hash}`);
  await page.locator('.tree-node-day').waitFor();
}

/**
 * The landing day is whichever one the server picks, and a quiet day can hold
 * a single prompt — nothing to space out and nothing to fold. Step back until
 * the tree actually branches, and skip rather than assert on an empty history.
 */
async function openBranchingDay(page: Page, minFolded = 2) {
  await openExplorer(page);
  const previous = page.getByRole('button', { name: 'Previous day' });
  for (let step = 0; step < 12; step += 1) {
    if (await page.locator('.tree-node.is-folded').count() >= minFolded) return;
    if (await previous.isDisabled()) break;
    await previous.click();
    await page.locator('.tree-node-day').waitFor();
  }
  test.skip(
    await page.locator('.tree-node.is-folded').count() < minFolded,
    `no recorded day has ${minFolded} or more branches to fold`
  );
}

/**
 * `.is-current` and the block stepper only exist on a day with more than one
 * time block, since a single block is the whole day.
 */
async function openMultiBlockDay(page: Page) {
  await openExplorer(page);
  const previous = page.getByRole('button', { name: 'Previous day' });
  for (let step = 0; step < 12; step += 1) {
    if (await page.locator('.tree-node.is-current').count() > 0) return;
    if (await previous.isDisabled()) break;
    await previous.click();
    await page.locator('.tree-node-day').waitFor();
  }
  test.skip(
    await page.locator('.tree-node.is-current').count() === 0,
    'no recorded day has more than one time block'
  );
}

/** The pixel gaps between the nodes sharing the bottom row of the drawing. */
async function bottomRowGaps(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const xs = [...document.querySelectorAll('.tree-node.is-folded, .tree-node-observation')]
      .map(n => Number(/translate\(([-\d.]+)/.exec(n.getAttribute('transform') ?? '')?.[1]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return xs.slice(1).map((x, i) => x - xs[i]).filter(gap => gap > 0.5);
  });
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.get('/api/explorer/day').catch(() => null);
  test.skip(!response?.ok(), 'viewer worker is not running on the configured port');
  // A fresh profile opens on the welcome modal, whose backdrop swallows every
  // click meant for the canvas underneath.
  await page.addInitScript(() => {
    try { localStorage.setItem('claude-mem-welcome-dismissed-v3', 'true'); } catch { /* private mode */ }
  });
});

test('opens folded at the prompt tier, with no observations drawn', async ({ page }) => {
  await openBranchingDay(page, 1);

  await expect(page.locator('.tree-node-observation')).toHaveCount(0);
  const prompts = page.locator('.tree-node-prompt');
  expect(await prompts.count()).toBeGreaterThan(0);
  // Every prompt is closed, and says so to assistive tech as well as visually.
  await expect(page.locator('.tree-node-prompt:not(.is-folded)')).toHaveCount(0);
  await expect(prompts.first()).toHaveAttribute('aria-expanded', 'false');

  // A folded node carries its hidden-observation count in its label, so the
  // fold hides detail without hiding that there is detail.
  await expect(page.locator('.tree-node.is-folded .tree-node-leaf-label').first())
    .toHaveText(/\(\d+\)$/);
});

test('folding buys real spacing: the bottom row sits at the comfortable ceiling', async ({ page }) => {
  await openBranchingDay(page);

  const gaps = await bottomRowGaps(page);
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) {
    expect(gap).toBeGreaterThanOrEqual(MIN_COL_GAP - 0.01);
    expect(gap).toBeLessThanOrEqual(MAX_COL_GAP + 0.01);
  }
});

test('clicking a folded node opens it, and clicking it again closes it', async ({ page }) => {
  await openBranchingDay(page, 1);

  const target = page.locator('.tree-node.is-folded').first();
  const label = await target.getAttribute('aria-label');

  await target.locator('.tree-node-hit').click();
  await expect(page.locator('.tree-node-observation').first()).toBeVisible();
  const opened = page.locator(`.tree-node[aria-label="${label}"]`).first();
  await expect(opened).toHaveAttribute('aria-expanded', 'true');
  await expect(opened).not.toHaveClass(/is-folded/);

  // Opening a branch adds leaf slots, so the row can only get tighter — never
  // wider than the ceiling, never tighter than the floor.
  for (const gap of await bottomRowGaps(page)) {
    expect(gap).toBeGreaterThanOrEqual(MIN_COL_GAP - 0.01);
    expect(gap).toBeLessThanOrEqual(MAX_COL_GAP + 0.01);
  }

  await opened.locator('.tree-node-hit').click();
  await expect(page.locator(`.tree-node[aria-label="${label}"]`).first()).toHaveClass(/is-folded/);
});

test('fold state clears when the mode changes', async ({ page }) => {
  await openBranchingDay(page, 1);

  await page.locator('.tree-node.is-folded').first().locator('.tree-node-hit').click();
  await expect(page.locator('.tree-node-observation').first()).toBeVisible();

  await page.getByRole('button', { name: 'By Project' }).click();
  await expect(page.locator('.tree-node-observation')).toHaveCount(0);

  await page.getByRole('button', { name: 'By Time' }).click();
  await expect(page.locator('.tree-node-observation')).toHaveCount(0);
});

test('a deep link opens the ancestors of the observation it names', async ({ page }) => {
  await openBranchingDay(page, 2);
  await page.locator('.tree-node.is-folded').first().locator('.tree-node-hit').click();

  const leaf = page.locator('.tree-node-observation').first();
  await leaf.locator('.tree-node-hit').click();
  await expect(page).toHaveURL(/#\/explorer\/\d+$/);
  await expect(page.locator('.explorer-detail-panel')).toBeVisible();

  // Reload so the fold state is thrown away and only the deep link can open
  // the chain — a hash change alone would not remount the app.
  const deepLink = page.url();
  await page.reload();
  await page.locator('.tree-node-day').waitFor();

  const selected = page.locator('.tree-node-observation.is-selected');
  await expect(selected).toHaveCount(1);
  await expect(page.locator('.explorer-detail-panel')).toBeVisible();
  expect(page.url()).toBe(deepLink);

  // Everything not on that chain stays folded: the link opens a path, not the day.
  expect(await page.locator('.tree-node.is-folded').count()).toBeGreaterThan(0);

  // And the node it points at is scrolled into the canvas, not left off to one side.
  const inView = await page.evaluate(() => {
    const pane = document.querySelector('.tree-graph')!.getBoundingClientRect();
    const dot = document.querySelector('.tree-node-observation.is-selected .tree-node-dot')!.getBoundingClientRect();
    return dot.left >= pane.left - 1 && dot.right <= pane.right + 1;
  });
  expect(inView).toBe(true);
});

test('no leaf label is clipped by the edge of the canvas', async ({ page }) => {
  await openBranchingDay(page, 2);

  // Open the fattest branch: the deepest row is where the rotated labels reach
  // furthest past the last dot, and that is what the padding has to cover.
  const biggest = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.tree-node.is-folded')];
    return all
      .map((node, index) => ({ index, count: Number(/\((\d+)\)/.exec(node.textContent ?? '')?.[1] ?? 0) }))
      .sort((a, b) => b.count - a.count)[0].index;
  });
  await page.locator('.tree-node.is-folded').nth(biggest).locator('.tree-node-hit').click();
  await page.locator('.tree-node-observation').first().waitFor();

  const overflow = await page.evaluate(() => {
    const svg = document.querySelector('.tree-graph svg')!;
    const box = svg.getBoundingClientRect();
    const labels = [...svg.querySelectorAll('.tree-node-leaf-label')]
      .map(label => label.getBoundingClientRect());
    return {
      bottom: Math.max(...labels.map(l => l.bottom - box.bottom)),
      right: Math.max(...labels.map(l => l.right - box.right)),
    };
  });

  expect(overflow.bottom).toBeLessThanOrEqual(0);
  expect(overflow.right).toBeLessThanOrEqual(0);
});


test('the stepper marks one block on the canvas and moves the mark', async ({ page }) => {
  await openMultiBlockDay(page);

  await expect(page.locator('.tree-node.is-current')).toHaveCount(1);
  const first = await page.locator('.tree-node.is-current').getAttribute('aria-label');

  await page.getByRole('button', { name: 'Next time block' }).click();
  await expect(page.locator('.tree-node.is-current')).toHaveCount(1);
  expect(await page.locator('.tree-node.is-current').getAttribute('aria-label')).not.toBe(first);
});

test('stepping brings the marked block into the pane on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMultiBlockDay(page);

  const overflows = await page.evaluate(() => {
    const graph = document.querySelector('.tree-graph') as HTMLElement;
    return graph.scrollWidth > graph.clientWidth;
  });
  expect(overflows).toBe(true);

  await page.getByRole('button', { name: 'Next time block' }).click();
  // The scroll is smooth, so wait for it to settle rather than sampling mid-flight.
  await expect.poll(async () => page.evaluate(() => {
    const pane = document.querySelector('.tree-graph')!.getBoundingClientRect();
    const dot = document.querySelector('.tree-node.is-current .tree-node-dot')!.getBoundingClientRect();
    return dot.left >= pane.left - 1 && dot.right <= pane.right + 1;
  })).toBe(true);
});

test('the mark survives folding and unfolding a prompt', async ({ page }) => {
  await openMultiBlockDay(page);
  const before = await page.locator('.tree-node.is-current').getAttribute('aria-label');

  const prompt = page.locator('.tree-node.is-folded').first();
  await prompt.locator('.tree-node-hit').click();
  await expect(page.locator('.tree-node-observation').first()).toBeVisible();

  await expect(page.locator('.tree-node.is-current')).toHaveCount(1);
  expect(await page.locator('.tree-node.is-current').getAttribute('aria-label')).toBe(before);
});

test('the block controls are hidden where they could do nothing', async ({ page }) => {
  await openMultiBlockDay(page);
  await expect(page.locator('.explorer-locate')).toBeVisible();

  // By project the whole group was permanently disabled, so it is gone.
  await page.getByRole('button', { name: 'By Project' }).click();
  await expect(page.locator('.explorer-locate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next time block' })).toHaveCount(0);

  await page.getByRole('button', { name: 'By Time' }).click();
  await expect(page.locator('.explorer-locate')).toBeVisible();

  // Across every recorded day the same invariant holds: the block controls are
  // present exactly when there is a block cursor to drive, which on a one-block
  // day is never — the day is the block.
  const previous = page.getByRole('button', { name: 'Previous day' });
  for (let step = 0; step < 12; step += 1) {
    const state = await page.evaluate(() => ({
      controls: document.querySelectorAll('.explorer-locate').length,
      cursor: document.querySelectorAll('.tree-node.is-current').length,
    }));
    expect(state.controls).toBe(state.cursor);
    if (await previous.isDisabled()) break;
    await previous.click();
    await page.locator('.tree-node-day').waitFor();
  }
});

test('Locate pulses again when clicked twice on the same block', async ({ page }) => {
  await openMultiBlockDay(page);

  const startTime = async () => page.evaluate(() => {
    const pulse = document.querySelector('.tree-node-pulse');
    const animation = pulse?.getAnimations()[0];
    return animation ? Number(animation.startTime) : null;
  });

  await page.locator('.explorer-locate').click();
  await expect(page.locator('.tree-node-pulse')).toHaveCount(1);
  const first = await startTime();
  expect(first).not.toBeNull();

  // The ripple must be centred on the node it points at. A CSS transform on an
  // svg child scales about the whole viewport unless transform-box says
  // otherwise, which puts the ripple in a corner while every timing assertion
  // still passes.
  const offset = await page.evaluate(() => {
    const pulse = document.querySelector('.tree-node-pulse')!.getBoundingClientRect();
    const dot = document.querySelector('.tree-node.is-current .tree-node-dot')!.getBoundingClientRect();
    return Math.hypot(
      (pulse.left + pulse.width / 2) - (dot.left + dot.width / 2),
      (pulse.top + pulse.height / 2) - (dot.top + dot.height / 2),
    );
  });
  expect(offset).toBeLessThan(2);

  await page.locator('.explorer-locate').click();
  // A replay means a fresh animation, which carries a later start time.
  await expect.poll(async () => (await startTime() ?? 0) > (first ?? 0)).toBe(true);
});

/**
 * Commit b9f6da82 made .explorer the scroll owner. Folding changes the canvas
 * height on every click, so this is the regression most likely to come back.
 */
for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`the explorer keeps the scroll at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openExplorer(page);

    const metrics = await page.evaluate(() => {
      const explorer = document.querySelector('.explorer') as HTMLElement;
      const graph = document.querySelector('.tree-graph') as HTMLElement;
      const doc = document.documentElement;
      return {
        overflowY: getComputedStyle(explorer).overflowY,
        docScrollY: doc.scrollHeight - doc.clientHeight,
        docScrollX: doc.scrollWidth - doc.clientWidth,
        graphOverflowsInsideItself: graph.scrollWidth >= graph.clientWidth,
      };
    });

    expect(metrics.overflowY).toBe('auto');
    expect(metrics.docScrollY).toBe(0);
    expect(metrics.docScrollX).toBe(0);
    expect(metrics.graphOverflowsInsideItself).toBe(true);
  });
}
