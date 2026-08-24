import { test, expect, Page } from '@playwright/test';

/**
 * Chat asks the memory a question and shows the retrieval walk that answered.
 *
 * Almost every test here stubs /api/search/temporal. That is deliberate: the
 * real endpoint spawns a Claude Agent SDK subprocess per question, so a live
 * run is slow and its walk shape depends on how much history the machine has
 * recorded — the two-round walk is unreachable on a small database. Stubbing
 * makes the render deterministic; the one live test at the bottom is there to
 * catch the contract drifting out from under the stubs.
 */

const WALK_ROUTE = '**/api/search/temporal*';
const KEYWORD_ROUTE = '**/api/search?*';

function observation(id: number, title: string) {
  return {
    id,
    memory_session_id: 'mem-1',
    project: 'claude-mem',
    platform_source: 'claude',
    type: 'discovery',
    title,
    subtitle: null,
    narrative: null,
    text: null,
    facts: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: 1,
    created_at: '2026-07-14 09:00:00',
    created_at_epoch: Date.UTC(2026, 6, 14, 9),
  };
}

async function stubJson(page: Page, pattern: string, body: unknown, status = 200) {
  await page.route(pattern, route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function openChat(page: Page) {
  await page.goto('/#/chat');
  await page.locator('.chat-composer').waitFor();
}

async function askAbout(page: Page, question: string) {
  await page.locator('.chat-input').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
}

test.beforeEach(async ({ page }) => {
  const response = await page.request.get('/api/explorer/day').catch(() => null);
  test.skip(!response?.ok(), 'viewer worker is not running on the configured port');
  await page.addInitScript(() => {
    try { localStorage.setItem('claude-mem-welcome-dismissed-v3', 'true'); } catch { /* private mode */ }
  });
});

test('the sidebar reaches a real screen, not the coming-soon panel', async ({ page }) => {
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'Chat' }).click();

  await expect(page.locator('.chat-composer')).toBeVisible();
  await expect(page.locator('.coming-soon')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/chat$/);
});

test('a two-round walk is rendered step by step, ending in the observations', async ({ page }) => {
  await stubJson(page, WALK_ROUTE, {
    observations: [observation(1, 'Rebuilt the Explorer as a node-link tree')],
    traversal: { rounds: 2, daysWalked: ['2026-07-14', '2026-07-15'], sessionsWalked: ['mem-1'], indexRows: 500 },
    coverage: { indexed: { claude: 480, codex: 20 }, matched: { claude: 1 } },
    strategy: 'vectorless',
  });

  await openChat(page);
  await askAbout(page, 'what changed in the explorer');

  await expect(page.locator('.chat-turn-badge')).toHaveText('retrieval walk');
  const steps = page.locator('.chat-step-label');
  await expect(steps).toHaveText(['Built the index', 'Narrowed to days', 'Picked the answers']);
  await expect(page.locator('.chat-walk')).toContainText('2026-07-15');
  // A source that was indexed but never picked is surfaced, not buried.
  await expect(page.locator('.chat-turn-note')).toContainText('codex');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);
});

test('a one-round walk says the day pass was skipped instead of faking it', async ({ page }) => {
  await stubJson(page, WALK_ROUTE, {
    observations: [],
    traversal: { rounds: 1, daysWalked: ['2026-07-14', '2026-07-15'], sessionsWalked: [], indexRows: 81 },
    coverage: { indexed: { claude: 81 }, matched: {} },
    strategy: 'vectorless',
  });

  await openChat(page);
  await askAbout(page, 'anything about tests');

  await expect(page.locator('.chat-step-label')).toHaveText(['Built the index', 'Skipped day narrowing', 'Picked the answers']);
  await expect(page.locator('.chat-walk')).toContainText('81 observations');
  await expect(page.locator('.chat-turn')).toContainText('No observations matched.');
});

test('with vectorless off it falls back to keyword search and says so verbatim', async ({ page }) => {
  // 409, not 200: the walk could not run, and the status says so before the
  // body is even read.
  await stubJson(page, WALK_ROUTE, {
    error: 'Vectorless retrieval is disabled',
    hint: 'Set CLAUDE_MEM_VECTORLESS_ENABLED=true in ~/.claude-mem/settings.json and restart the worker',
  }, 409);
  await stubJson(page, KEYWORD_ROUTE, {
    observations: [observation(7, 'Added the Playwright harness')],
    sessions: [{}, {}],
    prompts: [{}],
    totalResults: 4,
  });

  await openChat(page);
  await askAbout(page, 'playwright');

  await expect(page.locator('.chat-turn-badge')).toHaveText('keyword search');
  // The server's own words, not a paraphrase this screen invented.
  await expect(page.locator('.chat-turn')).toContainText('CLAUDE_MEM_VECTORLESS_ENABLED=true');
  // No walk happened, so no steps are drawn.
  await expect(page.locator('.chat-step')).toHaveCount(0);
  await expect(page.locator('.chat-turn')).toContainText('2 session summaries and 1 prompt also matched');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);
});

test('a failing walk still answers, through the keyword path', async ({ page }) => {
  await stubJson(page, WALK_ROUTE, { message: 'boom' }, 500);
  await stubJson(page, KEYWORD_ROUTE, { observations: [observation(9, 'Still answered')], sessions: [], prompts: [] });

  await openChat(page);
  await askAbout(page, 'anything');

  await expect(page.locator('.chat-turn')).toContainText('HTTP 500');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);
});

test('while walking the turn is already there, the input is locked, and Stop ends the wait', async ({ page }) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(WALK_ROUTE, async route => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"observations":[]}' });
  });

  await openChat(page);
  await askAbout(page, 'a question that takes its time');

  // The question is on screen before the answer exists — the whole point of
  // spending forty seconds is not staring at an unchanged page.
  await expect(page.locator('.chat-turn-question')).toHaveText('a question that takes its time');
  await expect(page.locator('.chat-skeleton').first()).toBeVisible();
  await expect(page.locator('.chat-input')).toBeDisabled();

  await page.getByRole('button', { name: 'Stop waiting' }).click();
  await expect(page.locator('.chat-turn')).toContainText('Stopped waiting');
  await expect(page.locator('.chat-input')).toBeEnabled();
  release?.();
});

test('an answer survives a trip to another route', async ({ page }) => {
  await stubJson(page, WALK_ROUTE, {
    observations: [observation(3, 'Survived the round trip')],
    traversal: { rounds: 1, daysWalked: ['2026-07-14'], sessionsWalked: ['mem-1'], indexRows: 10 },
    coverage: { indexed: { claude: 10 }, matched: { claude: 1 } },
  });

  await openChat(page);
  await askAbout(page, 'keep me');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);

  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.locator('.tree-node-day').waitFor();
  await page.getByRole('button', { name: 'Chat' }).click();

  await expect(page.locator('.chat-turn-question')).toHaveText('keep me');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);
});

test('the page holds together at 375x812 with no horizontal document scroll', async ({ page }) => {
  await stubJson(page, WALK_ROUTE, {
    observations: [observation(4, 'A title long enough to need wrapping on a narrow phone screen')],
    traversal: { rounds: 2, daysWalked: ['2026-07-14', '2026-07-15'], sessionsWalked: ['mem-1'], indexRows: 500 },
    coverage: { indexed: { claude: 500 }, matched: { claude: 1 } },
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await openChat(page);
  await askAbout(page, 'narrow');
  await expect(page.locator('.chat-results .card')).toHaveCount(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the live endpoint still answers in one of the two shapes the screen knows', async ({ page }) => {
  // No stub: this is the contract check. It asserts the shape, never the
  // content, because the walk is an LLM and the database keeps growing.
  const response = await page.request.get('/api/search/temporal?query=explorer&limit=1');
  const body = await response.json() as Record<string, unknown>;

  // Vectorless off is a 409 carrying the explanation; a walk that ran is a 200.
  if (response.status() === 409) {
    expect(body.error).toBe('Vectorless retrieval is disabled');
    expect(typeof body.hint).toBe('string');
    return;
  }
  expect(response.ok()).toBeTruthy();
  expect(Array.isArray(body.observations)).toBeTruthy();
  expect(body.traversal).toMatchObject({
    rounds: expect.any(Number),
    indexRows: expect.any(Number),
  });
});
