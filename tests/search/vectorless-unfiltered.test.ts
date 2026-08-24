import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';

// The vectorless walk loads its index with searchObservations(undefined, {...}).
// A temporal_search carrying only a query supplies no project/platformSource/
// dateRange, so the filter-only guard used to reject it and the orchestrator
// silently fell back to SQLite — the walk never ran. These tests exercise the
// real SessionSearch (no stub) because a stubbed one cannot see that guard.
describe('vectorless unfiltered index load', () => {
  let store: SessionStore;
  let search: SessionSearch;

  function seedObservation(title: string, narrative: string): void {
    const sdkId = store.createSDKSession(`sess-${title}`, 'walk-project', 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(sdkId, `mem-${title}`);
    store.storeObservation(`mem-${title}`, 'walk-project', {
      type: 'discovery',
      title,
      subtitle: null,
      facts: [],
      narrative,
      concepts: [],
      files_read: [],
      files_modified: [],
    }, 1);
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    search = new SessionSearch(store.db);
    seedObservation('First finding', 'worker restart handling');
    seedObservation('Second finding', 'pid file logic');
  });

  afterEach(() => {
    store.close();
  });

  it('returns rows for a filter-only search when allowUnfiltered is set', () => {
    const results = search.searchObservations(undefined, {
      allowUnfiltered: true,
      limit: 10,
      orderBy: 'date_desc',
    });
    expect(results.length).toBe(2);
  });

  it('still rejects a filter-only search without allowUnfiltered', () => {
    expect(() => search.searchObservations(undefined, { limit: 10, orderBy: 'date_desc' }))
      .toThrow('Either query or filters required for search');
  });

  it('walks the index when temporal_search supplies only a query', async () => {
    const llm = async (prompt: string): Promise<string> => {
      if (prompt.includes('selecting memory observations')) {
        const ids = [...prompt.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1]));
        return JSON.stringify({ ids });
      }
      return JSON.stringify({ days: [] });
    };
    const strategy = new VectorlessSearchStrategy(search, llm, { maxIndexRows: 500, maxDays: 14 });

    const result = await strategy.search({ query: 'worker restart' });

    expect(result.strategy).toBe('vectorless');
    expect(result.traversal?.indexRows).toBe(2);
    expect(result.results.observations.length).toBe(2);
  });
});
