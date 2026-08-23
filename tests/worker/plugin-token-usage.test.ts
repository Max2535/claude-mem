import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { recordPluginTokenUsage, turnCostFromCumulative } from '../../src/services/worker/token-usage/plugin-usage.js';
import type { ActiveSession } from '../../src/services/worker-types.js';

type ProviderSession = Pick<ActiveSession, 'sessionDbId' | 'contentSessionId' | 'project' | 'platformSource'>;

const session: ProviderSession = {
  sessionDbId: 7,
  contentSessionId: 'cc-session-7',
  project: 'claude-mem',
  platformSource: 'claude',
};

describe('recordPluginTokenUsage', () => {
  let store: SessionStore;
  let dbManager: { getSessionStore: () => SessionStore };

  beforeEach(() => {
    store = new SessionStore(':memory:');
    dbManager = { getSessionStore: () => store };
  });

  afterEach(() => {
    store.close();
  });

  function rows() {
    return store.db.prepare('SELECT * FROM token_usage_events ORDER BY id').all() as Array<Record<string, any>>;
  }

  it('writes the four buckets separately rather than a single total', () => {
    recordPluginTokenUsage(dbManager as never, session, 'observer', 'plugin:claude:abc', {
      model: 'claude-opus-5',
      inputTokens: 12,
      cacheCreationTokens: 40225,
      cacheReadTokens: 190000,
      outputTokens: 174,
      costUsd: 0.031,
    });

    const [row] = rows();
    expect(row.source).toBe('plugin');
    expect(row.component).toBe('observer');
    expect(row.input_tokens).toBe(12);
    expect(row.cache_creation_tokens).toBe(40225);
    expect(row.cache_read_tokens).toBe(190000);
    expect(row.output_tokens).toBe(174);
    expect(row.cost_usd).toBeCloseTo(0.031);
    expect(row.model).toBe('claude-opus-5');
    expect(row.session_db_id).toBe(7);
  });

  it('records an unreported cost as NULL, never as zero spend', () => {
    recordPluginTokenUsage(dbManager as never, session, 'observer', 'plugin:gemini:xyz', { outputTokens: 9 });
    expect(rows()[0].cost_usd).toBeNull();
  });

  // Accounting runs inside the compression generator. A throw here would abort
  // a user's compression to protect a chart — the wrong trade every time.
  it('swallows a store failure instead of aborting the caller', () => {
    const broken = { getSessionStore: () => { throw new Error('database is locked'); } };
    expect(() => recordPluginTokenUsage(broken as never, session, 'observer', 'k', { outputTokens: 1 })).not.toThrow();
  });

  it('is a no-op on a repeated event key', () => {
    recordPluginTokenUsage(dbManager as never, session, 'observer', 'plugin:claude:same', { outputTokens: 1 });
    recordPluginTokenUsage(dbManager as never, session, 'observer', 'plugin:claude:same', { outputTokens: 999 });
    expect(rows().length).toBe(1);
    expect(rows()[0].output_tokens).toBe(1);
  });
});

describe('turnCostFromCumulative', () => {
  it('returns the delta against the prior cumulative total', () => {
    expect(turnCostFromCumulative(0.5, 0.2)).toBeCloseTo(0.3);
  });

  it('treats the first result of a session as the whole cost', () => {
    expect(turnCostFromCumulative(0.25, null)).toBeCloseTo(0.25);
    expect(turnCostFromCumulative(0.25, undefined)).toBeCloseTo(0.25);
  });

  // The SDK restarting resets its accumulator. Subtracting the old, larger
  // baseline would yield a negative and credit the user for real spend.
  it('takes the new total when the accumulator reset below the baseline', () => {
    expect(turnCostFromCumulative(0.05, 1.2)).toBeCloseTo(0.05);
  });

  it('reports nothing rather than guessing when no total was provided', () => {
    expect(turnCostFromCumulative(undefined, 0.2)).toBeUndefined();
    expect(turnCostFromCumulative(null, 0.2)).toBeUndefined();
    expect(turnCostFromCumulative('0.4', 0.2)).toBeUndefined();
    expect(turnCostFromCumulative(NaN, 0.2)).toBeUndefined();
  });
});
