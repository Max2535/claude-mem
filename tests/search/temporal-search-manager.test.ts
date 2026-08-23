import { describe, test, expect, mock, afterEach } from 'bun:test';
import { SearchManager, buildVectorlessConfig } from '../../src/services/worker/SearchManager.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';

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

/**
 * temporalSearch could not be tested end to end while the traversal runner was
 * hardcoded in the constructor: every call went to a real Claude Agent SDK
 * subprocess. It now takes the same injection createVectorlessLlmRunner(deps)
 * already had, so the walk can be scripted.
 */
describe('temporalSearch end to end with an injected traversal', () => {
  let store: SessionStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  function managerWithWalk(llm: (prompt: string) => Promise<string>): SearchManager {
    store = new SessionStore(':memory:');
    const search = new SessionSearch(store.db);
    for (const [title, source] of [['restart-fix', 'claude'], ['codex-note', 'codex']]) {
      const sdkId = store.createSDKSession(`sess-${title}`, 'walk-project', 'prompt', undefined, source);
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
    return new SearchManager(search, store, null, {} as any, {} as any, {
      vectorlessLlm: llm,
      vectorlessConfig: { maxIndexRows: 500, maxDays: 14 },
    });
  }

  test('walks the index and answers with observations, traversal and coverage', async () => {
    const prompts: string[] = [];
    const manager = managerWithWalk(async prompt => {
      prompts.push(prompt);
      const line = prompt.split('\n').find(l => l.includes('restart-fix'));
      const id = line ? Number(line.match(/^\[(\d+)\]/)?.[1]) : NaN;
      return JSON.stringify({ ids: Number.isNaN(id) ? [] : [id] });
    });

    const result = await manager.temporalSearch({ query: 'worker restart', limit: 5 });

    expect(prompts.length).toBe(1);
    expect(result.strategy).toBe('vectorless');
    expect(result.observations.map((o: any) => o.title)).toEqual(['restart-fix']);
    expect(result.traversal).toMatchObject({ rounds: 1, indexRows: 2 });
    expect(result.coverage.matched).toEqual({ claude: 1 });
    expect(result.coverage.total).toEqual({ claude: 1, codex: 1 });
  });

  test('says the walk is disabled rather than answering with an empty memory', async () => {
    store = new SessionStore(':memory:');
    const search = new SessionSearch(store.db);
    const manager = new SearchManager(search, store, null, {} as any, {} as any, {
      vectorlessConfig: null,
    });

    const result = await manager.temporalSearch({ query: 'worker restart' });

    expect(result.error).toBe('Vectorless retrieval is disabled');
    expect(result.hint).toContain('CLAUDE_MEM_VECTORLESS_ENABLED=true');
    expect(result.observations).toBeUndefined();
  });

  test('a filter reaches the index the walk is built from', async () => {
    const manager = managerWithWalk(async prompt => {
      // Only the codex row may appear in the index when the search is scoped
      // to codex; if it does not, the prompt cannot name it.
      expect(prompt).not.toContain('restart-fix');
      return JSON.stringify({ ids: [] });
    });

    const result = await manager.temporalSearch({ query: 'worker restart', platformSource: 'codex' });

    expect(result.coverage.indexed).toEqual({ codex: 1 });
    expect(result.coverage.total).toEqual({ codex: 1 });
  });
});
