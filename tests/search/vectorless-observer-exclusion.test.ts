import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../src/shared/paths.js';

/**
 * claude-mem's own compression agents run as sessions under
 * OBSERVER_SESSIONS_PROJECT. Every observation reader drops them
 * (PaginationHelper.ts:87 and its three siblings) — they are the tool watching
 * itself, not the user's work. The vectorless index did not, so it spent its
 * row budget on them and could hand them back as search results.
 */
describe('observer sessions and the vectorless index', () => {
  let store: SessionStore;
  let search: SessionSearch;

  function seed(title: string, project: string): void {
    const sdkId = store.createSDKSession(`sess-${title}`, project, 'prompt', undefined, 'claude');
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
    seed('real-work', 'walk-project');
    seed('observer-noise', OBSERVER_SESSIONS_PROJECT);
  });

  afterEach(() => {
    store.close();
  });

  it('excludes the observer project from a filter-only read when asked', () => {
    const rows = search.searchObservations(undefined, {
      allowUnfiltered: true,
      excludeObserverSessions: true,
      limit: 10,
      orderBy: 'date_desc',
    });

    expect(rows.map(r => r.title)).toEqual(['real-work']);
  });

  it('excludes it on the query path too', () => {
    const rows = search.searchObservations('restart', {
      excludeObserverSessions: true,
      limit: 10,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.project !== OBSERVER_SESSIONS_PROJECT)).toBe(true);
  });

  it('still returns observer rows when a reader does not ask to exclude them', () => {
    const rows = search.searchObservations(undefined, {
      allowUnfiltered: true,
      limit: 10,
      orderBy: 'date_desc',
    });

    expect(rows.map(r => r.title).sort()).toEqual(['observer-noise', 'real-work']);
  });

  it('keeps the exclusion compatible with a real filter, not instead of it', () => {
    const rows = search.searchObservations(undefined, {
      project: 'walk-project',
      excludeObserverSessions: true,
      limit: 10,
      orderBy: 'date_desc',
    });

    expect(rows.map(r => r.title)).toEqual(['real-work']);
  });

  it('does not let the exclusion alone satisfy the unfiltered guard', () => {
    // A scan of every project but one is still a scan of every project. If the
    // exclusion counted as a filter, this call would quietly succeed.
    expect(() => search.searchObservations(undefined, {
      excludeObserverSessions: true,
      limit: 10,
    })).toThrow(/search/i);
  });

  it('keeps observer sessions out of the vectorless index and its results', async () => {
    const strategy = new VectorlessSearchStrategy(
      search,
      // Stub traversal: picks every observation it is shown, so anything that
      // reaches the index can reach the results.
      async (prompt: string) => {
        const ids = [...prompt.matchAll(/^\[(\d+)\]/gm)].map(m => m[1]);
        return JSON.stringify({ ids: ids.map(Number) });
      },
      { maxIndexRows: 100, maxDays: 30 }
    );

    const result = await strategy.search({ query: 'restart', limit: 10 });

    expect(result.traversal?.indexRows).toBe(1);
    expect(result.results.observations.map(o => o.title)).toEqual(['real-work']);
  });
});
