import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { PaginationHelper } from '../../src/services/worker/PaginationHelper.js';

describe('token burn query cost', () => {
  let store: SessionStore;
  let helper: PaginationHelper;

  /**
   * The SQL getTokenBurn actually prepares. Asserting a plan against a query
   * retyped in the test would pass whatever the helper does — that is a
   * fixture describing the test's own opinion, not the code.
   */
  function preparedSql(run: () => void): string[] {
    const sqls: string[] = [];
    const realPrepare = store.db.prepare.bind(store.db);
    (store.db as any).prepare = (sql: string) => {
      sqls.push(sql);
      return realPrepare(sql);
    };
    try {
      run();
    } finally {
      (store.db as any).prepare = realPrepare;
    }
    return sqls;
  }

  function planOf(sql: string, ...params: any[]): string {
    return (store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
      .map(row => row.detail)
      .join(' | ');
  }

  function aggregateSql(sqls: string[]): string {
    const found = sqls.find(sql => sql.includes('FROM token_usage_events') && sql.includes('GROUP BY'));
    if (!found) throw new Error('getTokenBurn prepared no aggregate over token_usage_events');
    return found;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    helper = new PaginationHelper({ getSessionStore: () => store } as any);

    // Two years of history so a 30-day window is a small slice of the table:
    // a scan and a seek only differ visibly once most rows are out of scope.
    const now = Date.now();
    for (let i = 0; i < 1500; i++) {
      store.recordTokenUsage({
        eventKey: `seed-${i}`,
        source: i % 2 === 0 ? 'plugin' : 'user',
        component: i % 2 === 0 ? 'observer' : 'session',
        project: i % 3 === 0 ? 'claude-mem' : 'other',
        outputTokens: 10,
        epoch: now - i * 12 * 3_600_000,
      });
    }
    store.db.run('ANALYZE');
  });

  afterEach(() => {
    store.close();
  });

  it('seeks the window on an index instead of scanning the table', () => {
    const sql = aggregateSql(preparedSql(() => helper.getTokenBurn(30)));
    const plan = planOf(sql, '-29 days');

    expect(plan).toContain('token_usage_events');
    expect(plan).toMatch(/USING (COVERING )?INDEX idx_token_usage_(range|scope)/);
    // A bare SCAN means every row of every year is read to draw one month.
    expect(plan).not.toMatch(/SCAN token_usage_events(?! USING)/);
  });

  it('still seeks when the window is narrowed to one project', () => {
    const sql = aggregateSql(preparedSql(() => helper.getTokenBurn(30, 'claude-mem')));
    const plan = planOf(sql, '-29 days', 'claude-mem');

    expect(plan).toMatch(/USING (COVERING )?INDEX idx_token_usage_/);
    expect(plan).not.toMatch(/SCAN token_usage_events(?! USING)/);
  });

  // date() on the indexed column cannot be seeked. The window bound must stay
  // a plain comparison against created_at_epoch, with date() only in GROUP BY.
  it('keeps the window predicate off a function of the indexed column', () => {
    const sql = aggregateSql(preparedSql(() => helper.getTokenBurn(30)));
    const whereClause = sql.slice(sql.indexOf('WHERE'), sql.indexOf('GROUP BY'));

    expect(whereClause).toContain('created_at_epoch >=');
    expect(whereClause).not.toContain("date(created_at_epoch");
  });

  it('answers the same numbers a naive date-equality grouping would', () => {
    const response = helper.getTokenBurn(30);
    const naive = store.db.prepare(`
      SELECT date(created_at_epoch / 1000, 'unixepoch', 'localtime') AS bucket,
             source, SUM(output_tokens) AS output_tokens
        FROM token_usage_events
       WHERE date(created_at_epoch / 1000, 'unixepoch', 'localtime') >= date('now', 'localtime', '-29 days')
       GROUP BY bucket, source
    `).all() as Array<{ bucket: string; source: string; output_tokens: number }>;

    const expectedPlugin = naive.filter(r => r.source === 'plugin').reduce((sum, r) => sum + r.output_tokens, 0);
    const expectedUser = naive.filter(r => r.source === 'user').reduce((sum, r) => sum + r.output_tokens, 0);

    expect(response.totals.plugin.outputTokens).toBe(expectedPlugin);
    expect(response.totals.user.outputTokens).toBe(expectedUser);
  });

  // The zero-fill span and the GROUP BY must resolve "local" through the same
  // engine. When they do not, buckets miss their slot and spend vanishes.
  it('loses no spend between the SQL grouping and the zero-filled span', () => {
    const response = helper.getTokenBurn(30);
    const inWindow = store.db.prepare(`
      SELECT COALESCE(SUM(output_tokens), 0) AS total FROM token_usage_events
       WHERE created_at_epoch >= CAST(strftime('%s', date('now','localtime','-29 days') || ' 00:00:00','utc') AS INTEGER) * 1000
    `).get() as { total: number };

    const summed = response.buckets.reduce(
      (sum, b) => sum + b.plugin.outputTokens + b.user.outputTokens,
      0
    );
    expect(summed).toBe(inWindow.total);
  });
});
