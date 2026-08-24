import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';
import { buildDayIndex, renderDayIndex, renderObservationIndex } from '../../src/services/worker/search/vectorless/IndexBuilder.js';

// The unit tests for computeSourceCoverage build their rows by hand, so they
// pass whether or not the SQL ever projects platform_source. It did not: the
// filter-only branch of searchObservations selected `o.*` with no reach into
// sdk_sessions, so every row read as 'claude' and the per-source breakdown the
// temporal_search tool advertises was a constant. These tests go through a real
// database for exactly that reason — a stubbed SessionSearch cannot see it.
describe('per-source coverage over a real database', () => {
  let store: SessionStore;
  let search: SessionSearch;

  function seed(title: string, platformSource: string): void {
    const sdkId = store.createSDKSession(`sess-${title}`, 'walk-project', 'prompt', undefined, platformSource);
    store.ensureMemorySessionIdRegistered(sdkId, `mem-${title}`);
    store.storeObservation(`mem-${title}`, 'walk-project', {
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
    seed('from-claude', 'claude');
    seed('from-codex', 'codex');
    seed('from-cursor', 'cursor');
  });

  afterEach(() => {
    store.close();
  });

  it('projects the owning session platform_source onto a filter-only search', () => {
    const rows = search.searchObservations(undefined, {
      allowUnfiltered: true,
      limit: 10,
      orderBy: 'date_desc',
    });
    expect(rows.length).toBe(3);
    expect(rows.map(r => r.platform_source).sort()).toEqual(['claude', 'codex', 'cursor']);
  });

  it('projects it on a query search too, so no code path reads as claude by default', () => {
    const rows = search.searchObservations('restart', { limit: 10 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => typeof r.platform_source === 'string')).toBe(true);
    expect(new Set(rows.map(r => r.platform_source)).size).toBeGreaterThan(1);
  });

  it('reports the real source mix in a walk, not a single claude bucket', async () => {
    const llm = async (prompt: string): Promise<string> => {
      if (prompt.includes('selecting memory observations')) {
        // Pick only the codex row, so matched and indexed must differ.
        const line = prompt.split('\n').find(l => l.includes('from-codex'));
        const id = line ? Number(line.match(/^\[(\d+)\]/)?.[1]) : NaN;
        return JSON.stringify({ ids: Number.isNaN(id) ? [] : [id] });
      }
      return JSON.stringify({ days: [] });
    };
    const strategy = new VectorlessSearchStrategy(search, llm, { maxIndexRows: 500, maxDays: 14 });

    const result = await strategy.search({ query: 'worker restart' });

    expect(result.coverage?.indexed).toEqual({ claude: 1, codex: 1, cursor: 1 });
    expect(result.coverage?.matched).toEqual({ codex: 1 });
  });

  // The traversal prompt is the only thing the model sees. If every line is
  // labelled (claude), source cannot be a selection signal no matter what the
  // tool description promises.
  it('labels each index line with its real source, not a constant', () => {
    const rows = search.searchObservations(undefined, { allowUnfiltered: true, limit: 10, orderBy: 'date_desc' });

    const rendered = renderObservationIndex(rows);
    expect(rendered).toContain('(codex)');
    expect(rendered).toContain('(cursor)');
    expect(rendered).toContain('(claude)');

    const days = buildDayIndex(rows);
    expect(days.length).toBe(1);
    expect([...days[0].sources].sort()).toEqual(['claude', 'codex', 'cursor']);
    expect(renderDayIndex(days)).toContain('sources: ');
  });

  it('counts a session with no platform_source as claude rather than dropping it', () => {
    const sdkId = store.createSDKSession('sess-legacy', 'walk-project', 'prompt');
    store.ensureMemorySessionIdRegistered(sdkId, 'mem-legacy');
    store.db.prepare("UPDATE sdk_sessions SET platform_source = '' WHERE memory_session_id = ?").run('mem-legacy');
    store.storeObservation('mem-legacy', 'walk-project', {
      type: 'discovery',
      title: 'legacy row',
      subtitle: null,
      facts: [],
      narrative: 'worker restart handling',
      concepts: [],
      files_read: [],
      files_modified: [],
    }, 1);

    const rows = search.searchObservations(undefined, { allowUnfiltered: true, limit: 10, orderBy: 'date_desc' });
    const legacy = rows.find(r => r.title === 'legacy row');
    expect(legacy?.platform_source).toBe('claude');
  });
});
