import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../src/shared/paths.js';

/**
 * The walk indexes at most maxIndexRows. Without a denominator taken from
 * SQLite, a caller cannot tell "no memory of that" from "no memory of that in
 * the slice that was read" — on a 6,000-row database a 500-row index is 8% of
 * memory, and coverage.indexed would report 500/500 either way.
 */
describe('vectorless coverage denominator', () => {
  let store: SessionStore;
  let search: SessionSearch;

  function seed(title: string, platformSource: string, project = 'walk-project'): void {
    const sdkId = store.createSDKSession(`sess-${title}`, project, 'prompt', undefined, platformSource);
    store.ensureMemorySessionIdRegistered(sdkId, `mem-${title}`);
    store.storeObservation(`mem-${title}`, project, {
      type: 'discovery',
      title,
      subtitle: null,
      facts: [],
      narrative: 'worker restart handling',
      concepts: [],
      files_read: [],
      files_modified: [],
    }, 1);
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    search = new SessionSearch(store.db);
    for (let i = 0; i < 6; i++) seed(`claude-${i}`, 'claude');
    for (let i = 0; i < 3; i++) seed(`codex-${i}`, 'codex');
    seed('observer-noise', 'claude', OBSERVER_SESSIONS_PROJECT);
  });

  afterEach(() => {
    store.close();
  });

  it('counts every matching row per source, not just the ones the index held', () => {
    const counts = search.countObservationsBySource({
      allowUnfiltered: true,
      excludeObserverSessions: true,
    });

    expect(counts).toEqual({ claude: 6, codex: 3 });
  });

  it('honours the same filters the index is built from', () => {
    expect(search.countObservationsBySource({ project: 'walk-project', platformSource: 'codex' }))
      .toEqual({ codex: 3 });
    expect(search.countObservationsBySource({ project: 'no-such-project' })).toEqual({});
  });

  it('refuses an unfiltered count unless the caller opted out, like searchObservations', () => {
    expect(() => search.countObservationsBySource({})).toThrow(/query or filters required/i);
  });

  /**
   * A COUNT, never the length of a fetched array, and never a re-read of every
   * observation row — that read is what getExplorerDay was fixed for.
   */
  it('counts in SQL without projecting observation rows', () => {
    const sqls: string[] = [];
    const realPrepare = store.db.prepare.bind(store.db);
    (store.db as any).prepare = (sql: string) => {
      sqls.push(sql);
      return realPrepare(sql);
    };
    try {
      search.countObservationsBySource({ allowUnfiltered: true, excludeObserverSessions: true });
    } finally {
      (store.db as any).prepare = realPrepare;
    }

    expect(sqls.length).toBe(1);
    expect(sqls[0]).toContain('COUNT(*)');
    expect(sqls[0]).not.toContain('o.*');
    expect(sqls[0]).not.toContain('LIMIT');
  });

  it('reports the cap as truncation, with the full count as the denominator', async () => {
    const strategy = new VectorlessSearchStrategy(
      search,
      async () => JSON.stringify({ ids: [] }),
      { maxIndexRows: 4, maxDays: 14 }
    );

    const result = await strategy.search({ query: 'worker restart' });

    expect(result.traversal?.indexRows).toBe(4);
    expect(result.coverage?.total).toEqual({ claude: 6, codex: 3 });
    // 4 rows of 9 were indexed, so at least one source is short of its total.
    const indexedTotal = Object.values(result.coverage!.indexed).reduce((a, b) => a + b, 0);
    expect(indexedTotal).toBe(4);
    expect(Object.values(result.coverage!.truncated).some(Boolean)).toBe(true);
  });

  it('reports no truncation when the index holds everything the filter matched', async () => {
    const strategy = new VectorlessSearchStrategy(
      search,
      async () => JSON.stringify({ ids: [] }),
      { maxIndexRows: 500, maxDays: 14 }
    );

    const result = await strategy.search({ query: 'worker restart' });

    expect(result.coverage?.total).toEqual({ claude: 6, codex: 3 });
    expect(result.coverage?.truncated).toEqual({ claude: false, codex: false });
  });
});
