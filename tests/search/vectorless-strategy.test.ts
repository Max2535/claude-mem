import { describe, test, expect } from 'bun:test';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';
import type { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

function obs(id: number, created_at: string, title: string, session = 'sess-a'): ObservationSearchResult {
  return {
    id, memory_session_id: session, project: 'demo', text: null, type: 'discovery',
    title, subtitle: null, facts: null, narrative: null, concepts: null,
    files_read: null, files_modified: null, prompt_number: null, discovery_tokens: 0,
    created_at, created_at_epoch: 0,
  } as ObservationSearchResult;
}

const ROWS = [
  obs(3, '2026-08-19 09:00:00', 'fix worker restart', 'sess-b'),
  obs(2, '2026-08-18 15:00:00', 'chroma sync retry'),
  obs(1, '2026-08-17 10:00:00', 'schema migration'),
];

function stubSearch(rows: ObservationSearchResult[]): SessionSearch {
  return { searchObservations: () => rows } as unknown as SessionSearch;
}

describe('VectorlessSearchStrategy', () => {
  test('single pass when days fit maxDays: one LLM call selecting ids', async () => {
    const calls: string[] = [];
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async (p) => { calls.push(p); return '{"ids":[3,1]}'; },
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'restart bug', limit: 20 });
    expect(calls.length).toBe(1);
    expect(result.strategy).toBe('vectorless');
    expect(result.results.observations.map(o => o.id)).toEqual([3, 1]);
    expect(result.traversal?.rounds).toBe(1);
    expect(result.traversal?.daysWalked).toEqual(['2026-08-19', '2026-08-18', '2026-08-17']);
    expect(result.traversal?.sessionsWalked.sort()).toEqual(['sess-a', 'sess-b']);
    expect(result.coverage?.indexed).toEqual({ claude: 3 });
    expect(result.coverage?.matched).toEqual({ claude: 2 });
  });

  test('two rounds when days exceed maxDays: day selection narrows candidates', async () => {
    const responses = ['{"days":["2026-08-19","2026-08-17"]}', '{"ids":[1]}'];
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async () => responses.shift()!,
      { maxIndexRows: 500, maxDays: 2 }
    );
    const result = await strategy.search({ query: 'migration', limit: 20 });
    expect(result.traversal?.rounds).toBe(2);
    expect(result.traversal?.daysWalked).toEqual(['2026-08-19', '2026-08-17']);
    expect(result.results.observations.map(o => o.id)).toEqual([1]);
  });

  test('empty query or no rows returns empty result without LLM calls', async () => {
    let called = 0;
    const strategy = new VectorlessSearchStrategy(
      stubSearch([]),
      async () => { called++; return '{}'; },
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'anything', limit: 20 });
    expect(called).toBe(0);
    expect(result.results.observations).toEqual([]);
    expect(result.coverage).toEqual({ indexed: {}, matched: {} });
  });

  test('ids not in candidate set are dropped', async () => {
    const strategy = new VectorlessSearchStrategy(
      stubSearch(ROWS),
      async () => '{"ids":[999,2]}',
      { maxIndexRows: 500, maxDays: 14 }
    );
    const result = await strategy.search({ query: 'retry', limit: 20 });
    expect(result.results.observations.map(o => o.id)).toEqual([2]);
  });
});
