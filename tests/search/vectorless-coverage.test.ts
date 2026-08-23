import { describe, test, expect } from 'bun:test';
import { computeSourceCoverage } from '../../src/services/worker/search/vectorless/coverage.js';
import type { ObservationSearchResult } from '../../src/services/worker/search/types.js';

// platform_source is a declared member of ObservationSearchResult, projected by
// every observation SELECT in SessionSearch — so this fixture states it rather
// than casting it on. That the query really projects it is proved separately in
// vectorless-coverage-sources.test.ts; this file only tests the counting.
function obs(id: number, platform_source?: string): ObservationSearchResult {
  return {
    id,
    memory_session_id: `s-${id}`,
    project: 'demo',
    text: null,
    type: 'discovery',
    title: `obs ${id}`,
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    discovery_tokens: 0,
    created_at: '2026-08-18 10:00:00',
    created_at_epoch: 1787392800000,
    ...(platform_source !== undefined ? { platform_source } : {}),
  };
}

describe('computeSourceCoverage', () => {
  test('counts normalized sources for indexed and matched sets', () => {
    const indexed = [obs(1, 'claude'), obs(2, 'codex'), obs(3, 'browser'), obs(4)];
    const matched = [indexed[0], indexed[2]];
    const coverage = computeSourceCoverage(indexed, matched);
    expect(coverage.indexed).toEqual({ claude: 2, codex: 1, browser: 1 }); // undefined → 'claude'
    expect(coverage.matched).toEqual({ claude: 1, browser: 1 });
    // No denominator supplied: the index IS the whole filtered set by definition.
    expect(coverage.total).toEqual({ claude: 2, codex: 1, browser: 1 });
    expect(coverage.truncated).toEqual({ claude: false, codex: false, browser: false });
  });

  test('a denominator larger than the index marks that source truncated', () => {
    const indexed = [obs(1, 'claude'), obs(2, 'codex')];
    const coverage = computeSourceCoverage(indexed, [indexed[0]], { claude: 900, codex: 1 });
    expect(coverage.total).toEqual({ claude: 900, codex: 1 });
    expect(coverage.truncated).toEqual({ claude: true, codex: false });
  });

  test('empty inputs produce empty maps', () => {
    expect(computeSourceCoverage([], [])).toEqual({ indexed: {}, matched: {}, total: {}, truncated: {} });
  });
});
