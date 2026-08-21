import { describe, test, expect } from 'bun:test';
import { buildVectorlessConfig } from '../../src/services/worker/SearchManager.js';

describe('buildVectorlessConfig', () => {
  test('disabled returns null', () => {
    expect(buildVectorlessConfig({ CLAUDE_MEM_VECTORLESS_ENABLED: 'false' } as any)).toBeNull();
  });

  test('enabled parses numeric bounds with defaults on garbage', () => {
    const config = buildVectorlessConfig({
      CLAUDE_MEM_VECTORLESS_ENABLED: 'true',
      CLAUDE_MEM_VECTORLESS_MAX_INDEX_ROWS: '250',
      CLAUDE_MEM_VECTORLESS_MAX_DAYS: 'not-a-number',
    } as any);
    expect(config).toEqual({ maxIndexRows: 250, maxDays: 14 });
  });
});
