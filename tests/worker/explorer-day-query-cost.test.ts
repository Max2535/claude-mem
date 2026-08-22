import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { PaginationHelper } from '../../src/services/worker/PaginationHelper.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../src/shared/paths.js';

/**
 * The Explorer refetches this roughly once a second while capture is running
 * (useExplorerDay.ts:44), and both of its queries used to read every
 * observation row: the days list because date(...) cannot be seeked, and the
 * per-day list because it compared that same computed value with `=`.
 *
 * The results were already correct and stay correct if the fix is reverted, so
 * the plan assertions are the real test here. The equivalence tests guard the
 * other direction — that making it cheap did not move any row to another day.
 */
describe('getExplorerDay query cost', () => {
  let store: SessionStore;
  let helper: PaginationHelper;
  const project = 'cost-project';

  function seed(memoryId: string, epoch: number, obsProject = project): void {
    const dbId = store.createSDKSession(`sess-${memoryId}`, obsProject, 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(dbId, memoryId);
    store.storeObservation(
      memoryId,
      obsProject,
      { type: 'discovery', title: memoryId, subtitle: null, facts: [], narrative: 'n', concepts: [], files_read: [], files_modified: [] },
      1,
      0,
      epoch
    );
  }

  /** The day SQLite puts an epoch on — the only opinion that matters here. */
  function sqlDayOf(epoch: number): string {
    return (store.db.prepare(
      `SELECT date(? / 1000, 'unixepoch', 'localtime') AS day`
    ).get(epoch) as { day: string }).day;
  }

  /**
   * The SQL getExplorerDay actually prepares. Asserting a plan against a query
   * retyped in the test would pass whatever the helper does — the same
   * fabricated-fixture trap these fixes came out of.
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

  // Spread across four weeks at an interval that is not a divisor of a day, so
  // rows land at every hour rather than clustering at one.
  const FIRST = Date.UTC(2024, 5, 1);
  const STEP_MS = 7 * 3_600_000;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    helper = new PaginationHelper({ getSessionStore: () => store } as any);
    for (let i = 0; i < 96; i++) seed(`mem-${i}`, FIRST + i * STEP_MS);
    seed('mem-observer', FIRST + 3 * STEP_MS, OBSERVER_SESSIONS_PROJECT);
  });

  afterEach(() => {
    store.close();
  });

  it('serves the distinct-days scan from a covering index instead of the table', () => {
    const [daysSql] = preparedSql(() => helper.getExplorerDay(undefined))
      .filter(sql => sql.includes('DISTINCT'));
    expect(daysSql).toBeDefined();

    const detail = planOf(daysSql, OBSERVER_SESSIONS_PROJECT);

    // The scan is unavoidable — a computed day cannot be seeked. Reading it out
    // of an index that carries project and created_at_epoch avoids touching
    // rows whose columns include the narrative and text blobs.
    expect(detail).toContain('idx_observations_day_scope');
    expect(detail).toContain('COVERING INDEX');
  });

  it('seeks the selected day by epoch range rather than testing a computed date', () => {
    const [daySql] = preparedSql(() => helper.getExplorerDay('2024-06-02'))
      .filter(sql => sql.includes('promptNumber'));
    expect(daySql).toBeDefined();

    const detail = planOf(daySql, OBSERVER_SESSIONS_PROJECT, '2024-06-02', '2024-06-02');

    expect(detail).toContain('SEARCH o USING INDEX idx_observations_created');
    expect(detail).not.toContain('SCAN o');
  });

  it('returns exactly the rows the computed-date comparison returned, every day', () => {
    const days = helper.getExplorerDay(undefined).days;
    expect(days.length).toBeGreaterThan(20);

    for (const day of days) {
      const viaDateExpr = (store.db.prepare(
        `SELECT o.id FROM observations o
         WHERE o.project != ?
           AND date(o.created_at_epoch / 1000, 'unixepoch', 'localtime') = ?
         ORDER BY o.created_at_epoch ASC`
      ).all(OBSERVER_SESSIONS_PROJECT, day) as { id: number }[]).map(r => r.id);

      expect(helper.getExplorerDay(day).observations.map(o => o.id)).toEqual(viaDateExpr);
    }
  });

  it('puts every seeded observation on exactly one day, so none is lost at a boundary', () => {
    const days = helper.getExplorerDay(undefined).days;
    const seen = days.flatMap(day => helper.getExplorerDay(day).observations.map(o => o.id));

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(96);
  });

  it('agrees with SQLite about which day a row belongs to, not with the JS timezone', () => {
    // The JS side and SQLite do not always name the same zone — under `bun
    // test` JS reports UTC while SQLite keeps the machine's. Bounds computed in
    // JS silently shifted rows a day in that case; these are computed in SQL.
    const epoch = FIRST + 5 * STEP_MS;
    const day = sqlDayOf(epoch);

    const ids = helper.getExplorerDay(day).observations.map(o => o.title);
    expect(ids).toContain('mem-5');
  });

  it('keeps observer sessions out of both the days list and the day', () => {
    const result = helper.getExplorerDay(undefined);
    const observerDay = sqlDayOf(FIRST + 3 * STEP_MS);

    expect(helper.getExplorerDay(observerDay).observations.map(o => o.title))
      .not.toContain('mem-observer');
    expect(result.observations.every(o => o.project !== OBSERVER_SESSIONS_PROJECT)).toBe(true);
  });
});
