import { describe, test, expect, mock } from 'bun:test';
import { SearchManager, buildVectorlessConfig } from '../../src/services/worker/SearchManager.js';

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

describe('temporalSearch limit', () => {
  /**
   * temporalSearch builds its own options object rather than going through
   * normalizeParams, so it needed the same guard separately. Whether the
   * strategy is enabled depends on the user's settings file, so both of those
   * collaborators are replaced here — the parsing is what is under test.
   */
  function managerWithSpyOrchestrator() {
    const manager = new SearchManager(
      { searchObservations: mock(() => []), searchSessions: mock(() => []), searchUserPrompts: mock(() => []) } as any,
      {} as any,
      null,
      {} as any,
      {} as any,
    );
    const search = mock(async () => ({
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'vectorless',
    }));
    (manager as any).vectorlessStrategy = {};
    (manager as any).orchestrator = { search };
    return { manager, search };
  }

  test('drops a limit that is not a number instead of sending NaN', async () => {
    const { manager, search } = managerWithSpyOrchestrator();

    await manager.temporalSearch({ query: 'worker restarts', limit: 'abc' });

    expect((search as any).mock.calls[0][0].limit).toBeUndefined();
  });

  test('passes a usable limit through as a number', async () => {
    const { manager, search } = managerWithSpyOrchestrator();

    await manager.temporalSearch({ query: 'worker restarts', limit: '12' });

    expect((search as any).mock.calls[0][0].limit).toBe(12);
  });

  test('drops a zero or negative limit rather than asking for no rows', async () => {
    const { manager, search } = managerWithSpyOrchestrator();

    await manager.temporalSearch({ query: 'worker restarts', limit: '0' });
    await manager.temporalSearch({ query: 'worker restarts', limit: '-3' });

    expect((search as any).mock.calls[0][0].limit).toBeUndefined();
    expect((search as any).mock.calls[1][0].limit).toBeUndefined();
  });
});
