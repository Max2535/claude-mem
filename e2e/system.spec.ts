import { test, expect, Page } from '@playwright/test';

/**
 * System reports on the worker running this very page. Most of it is read
 * live — the probes are cheap GETs, unlike the Chat walk — and stubbed only
 * where the interesting state (a dead probe, a degraded 503) cannot be
 * produced on a machine where everything happens to be working.
 */

const PROBES = ['**/api/health', '**/api/chroma/status', '**/api/mcp/status', '**/api/sync/status'];

async function stubJson(page: Page, pattern: string, body: unknown, status = 200) {
  await page.route(pattern, route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function openSystem(page: Page) {
  await page.goto('/#/system');
  await page.locator('.service-list').waitFor();
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.get('/api/health').catch(() => null);
  test.skip(!response, 'viewer worker is not running on the configured port');
  await page.addInitScript(() => {
    try { localStorage.setItem('claude-mem-welcome-dismissed-v3', 'true'); } catch { /* private mode */ }
  });
});

test('the sidebar reaches a real screen and no destination is unbuilt', async ({ page }) => {
  await page.goto('/');
  // The theme toggle also says "System"; the nav item is the exact one.
  await page.locator('.sidebar-nav-item', { hasText: 'System' }).click();

  await expect(page.locator('.coming-soon')).toHaveCount(0);
  await expect(page.locator('.page-title')).toHaveText('System');
  // Every nav item now has a screen; nothing in the sidebar is decorative.
  await expect(page.locator('.coming-soon-note')).toHaveCount(0);
});

test('the four tiles describe the process, not the corpus', async ({ page }) => {
  await openSystem(page);

  const labels = await page.locator('.stat-tile-label').allTextContents();
  expect(labels).toEqual(['Worker', 'Uptime', 'Queue', 'Database']);
  // The page is being served by the worker it is reporting on, so this one is
  // never in doubt.
  await expect(page.locator('.stat-tile').first().locator('.stat-tile-value')).toHaveText('Running');
});

test('every service states its condition in words, not only in colour', async ({ page }) => {
  await openSystem(page);

  const rows = page.locator('.service-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('.service-pill')).toHaveCount(count);

  for (const text of await page.locator('.service-pill').allTextContents()) {
    expect(text.trim().length).toBeGreaterThan(0);
  }
});

test('a probe that never answers is reported unread, never healthy and never broken', async ({ page }) => {
  for (const pattern of PROBES) await page.route(pattern, route => route.abort());

  await openSystem(page);

  const pills = await page.locator('.service-pill').allTextContents();
  expect(pills.length).toBeGreaterThan(0);
  expect(pills.every(text => text.trim() === 'Unread')).toBe(true);
  await expect(page.locator('.service-pill.is-problem')).toHaveCount(0);
  await expect(page.locator('.service-pill.is-ok')).toHaveCount(0);
  await expect(page.locator('.stat-tile').first().locator('.stat-tile-value')).toHaveText('Unreachable');
});

test('a degraded health answer is read even though it arrives as a 503', async ({ page }) => {
  // /api/health answers 503 when the queue is degraded, and that body carries
  // the only explanation there is. Dropping it on !res.ok would blank the
  // screen exactly when it has something to say.
  await stubJson(page, '**/api/health', {
    status: 'degraded',
    version: '13.15.3',
    pid: 4242,
    uptime: 120,
    ai: { provider: 'claude', authMethod: 'OAuth token' },
    dependencies: {
      degraded: true,
      statuses: [{ dependency: 'claude_cli', kind: 'setup_required', message: 'Claude CLI was not found on PATH', remediation: 'Run claude update.', recordedAtMs: 0 }],
    },
  }, 503);

  await openSystem(page);

  await expect(page.locator('.stat-tile').first().locator('.stat-tile-value')).toHaveText('Degraded');
  // The broken dependency sorts above the standing services rather than
  // being buried beneath four healthy rows.
  const first = page.locator('.service-row').first();
  await expect(first.locator('.service-name')).toHaveText('Claude CLI');
  await expect(first.locator('.service-pill')).toHaveClass(/is-problem/);
  await expect(first.locator('.service-fix')).toHaveText('Run claude update.');
});

test('a healthy worker draws no dependency row at all', async ({ page }) => {
  await stubJson(page, '**/api/health', {
    status: 'ok', version: '13.15.3', pid: 1, uptime: 60,
    ai: { provider: 'claude', authMethod: 'OAuth token' },
    dependencies: { degraded: false, statuses: [] },
  });

  await openSystem(page);
  const names = await page.locator('.service-name').allTextContents();
  expect(names).toEqual(['Semantic search', 'MCP server', 'Cloud sync', 'Compression model']);
});

test('the console on the page is the drawer console without the drawer', async ({ page }) => {
  await openSystem(page);

  const inPage = page.locator('.system-console .console-body');
  await expect(inPage).toHaveCount(1);
  // Nothing to close and nothing to resize: the page is not a drawer.
  await expect(inPage.getByTitle('Close console')).toHaveCount(0);
  await expect(page.locator('.system-console .console-resize-handle')).toHaveCount(0);
  await expect(inPage.locator('.console-filters')).toHaveCount(1);

  // The same component still mounts in the floating drawer, where it does
  // get a close button.
  await page.locator('.console-toggle-btn').click();
  const drawer = page.locator('.console-drawer .console-body');
  await expect(drawer).toHaveCount(1);
  await expect(drawer.getByTitle('Close console')).toHaveCount(1);
});

test('the three sidebar controls sit beside each other, none covering another', async ({ page }) => {
  // The console toggle used to be a floating button parked on top of this
  // row, hiding the theme toggle underneath it.
  await openSystem(page);

  // The header's help button shares the .settings-btn class, so scope to the
  // sidebar footer.
  const controls = ['.sidebar-footer .theme-toggle-btn', '.sidebar-footer .settings-btn', '.sidebar-footer .console-toggle-btn'];
  const boxes = [];
  for (const selector of controls) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} has no box`).not.toBeNull();
    boxes.push(box!);
  }

  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const overlaps =
        boxes[a].x < boxes[b].x + boxes[b].width && boxes[b].x < boxes[a].x + boxes[a].width &&
        boxes[a].y < boxes[b].y + boxes[b].height && boxes[b].y < boxes[a].y + boxes[a].height;
      expect(overlaps, `${controls[a]} overlaps ${controls[b]}`).toBe(false);
    }
  }

  // And each one is the element actually receiving a click at its own centre.
  for (const selector of controls) {
    const owner = await page.evaluate(sel => {
      const el = document.querySelector(sel) as HTMLElement;
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return el.contains(hit);
    }, selector);
    expect(owner, `${selector} is covered by something else`).toBe(true);
  }
});

test('the page holds together at 375x812 with no horizontal document scroll', async ({ page }) => {
  await stubJson(page, '**/api/health', {
    status: 'degraded', version: '13.15.3', pid: 1, uptime: 60,
    ai: { provider: 'claude', authMethod: 'Claude Code OAuth token (read from the system keychain at spawn)' },
    dependencies: {
      degraded: true,
      statuses: [{
        dependency: 'chroma',
        kind: 'vector_search_unavailable',
        message: 'Another claude-mem worker is holding the same Chroma data directory open, so this one cannot start it',
        remediation: 'Stop the other worker or configure a distinct CLAUDE_MEM_DATA_DIR, then restart claude-mem.',
        recordedAtMs: 0,
      }],
    },
  }, 503);

  await page.setViewportSize({ width: 375, height: 812 });
  await openSystem(page);
  await expect(page.locator('.service-fix').first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the live probes still answer in the shapes the screen reads', async ({ page }) => {
  // No stubs: the contract check. Shapes only — every value here changes with
  // the machine and with how long the worker has been up.
  const health = await page.request.get('/api/health');
  const body = await health.json() as Record<string, unknown>;
  expect(typeof body.status).toBe('string');
  expect(typeof body.version).toBe('string');
  expect(typeof body.uptime).toBe('number');
  expect(body.dependencies).toMatchObject({ degraded: expect.any(Boolean) });

  const chroma = await (await page.request.get('/api/chroma/status')).json() as Record<string, unknown>;
  expect(['healthy', 'unhealthy', 'disabled']).toContain(chroma.status);

  const mcp = await (await page.request.get('/api/mcp/status')).json() as Record<string, unknown>;
  expect(typeof mcp.enabled).toBe('boolean');

  const sync = await (await page.request.get('/api/sync/status')).json() as Record<string, unknown>;
  expect(typeof sync.configured).toBe('boolean');
});
