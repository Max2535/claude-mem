import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import type { TokenUsageEvent } from '../../src/services/sqlite/types.js';

function event(overrides: Partial<TokenUsageEvent> = {}): TokenUsageEvent {
  return {
    eventKey: 'cc:msg_1',
    source: 'user',
    component: 'session',
    inputTokens: 10,
    cacheCreationTokens: 20,
    cacheReadTokens: 300,
    outputTokens: 5,
    epoch: Date.UTC(2026, 5, 1, 12),
    ...overrides,
  };
}

describe('token usage schema (v50)', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('creates both tables and records exactly one version row', () => {
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('token_usage_events','transcript_read_state')")
      .all() as Array<{ name: string }>;
    expect(tables.map(t => t.name).sort()).toEqual(['token_usage_events', 'transcript_read_state']);

    const versions = store.db.prepare('SELECT COUNT(*) AS n FROM schema_versions WHERE version = 50').get() as { n: number };
    expect(versions.n).toBe(1);
  });

  // The UNIQUE index is not hygiene here: Claude Code fans one API response
  // across several JSONL lines carrying the same message.id. If this index
  // ever goes missing the user series silently over-counts by ~65%.
  it('enforces uniqueness on event_key with a real index', () => {
    const indexes = store.db.prepare('PRAGMA index_list(token_usage_events)').all() as Array<{ name: string; unique: number }>;
    const unique = indexes.filter(i => i.unique === 1);
    const keyed = unique.filter(i => {
      const cols = store.db.prepare(`PRAGMA index_info(${JSON.stringify(i.name)})`).all() as Array<{ name: string }>;
      return cols.length === 1 && cols[0].name === 'event_key';
    });
    expect(keyed.length).toBe(1);
  });

  it('carries the range and scope indexes the burn query seeks on', () => {
    const names = (store.db.prepare('PRAGMA index_list(token_usage_events)').all() as Array<{ name: string }>).map(i => i.name);
    expect(names).toContain('idx_token_usage_range');
    expect(names).toContain('idx_token_usage_scope');
  });

  it('treats a repeated event_key as a silent no-op, not an error', () => {
    store.recordTokenUsage(event());
    store.recordTokenUsage(event({ inputTokens: 999999 }));

    const rows = store.db.prepare('SELECT input_tokens FROM token_usage_events').all() as Array<{ input_tokens: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].input_tokens).toBe(10);
  });

  it('keeps the four token buckets separate rather than pre-summing them', () => {
    store.recordTokenUsage(event());
    const row = store.db.prepare('SELECT * FROM token_usage_events').get() as Record<string, unknown>;
    expect(row.input_tokens).toBe(10);
    expect(row.cache_creation_tokens).toBe(20);
    expect(row.cache_read_tokens).toBe(300);
    expect(row.output_tokens).toBe(5);
    expect('total_tokens' in row).toBe(false);
  });

  it('stores an unreported cost as NULL rather than zero', () => {
    store.recordTokenUsage(event({ eventKey: 'cc:no-cost' }));
    store.recordTokenUsage(event({ eventKey: 'cc:with-cost', costUsd: 0.42 }));

    const rows = store.db.prepare('SELECT event_key, cost_usd FROM token_usage_events ORDER BY event_key').all() as Array<{ event_key: string; cost_usd: number | null }>;
    expect(rows.find(r => r.event_key === 'cc:no-cost')?.cost_usd).toBeNull();
    expect(rows.find(r => r.event_key === 'cc:with-cost')?.cost_usd).toBeCloseTo(0.42);
  });

  it('rejects a source outside the two known series', () => {
    expect(() => store.recordTokenUsage(event({ source: 'nonsense' as never }))).toThrow();
  });

  it('advances the watermark and the rows together', () => {
    const inserted = store.recordTokenUsageBatch(
      [event({ eventKey: 'cc:a' }), event({ eventKey: 'cc:b' })],
      '/tmp/session.jsonl',
      2048,
      4096
    );
    expect(inserted).toBe(2);

    const state = store.getTranscriptReadState('/tmp/session.jsonl');
    expect(state?.byteOffset).toBe(2048);
    expect(state?.fileSize).toBe(4096);

    // Re-delivering the same batch must move the watermark without duplicating rows.
    const again = store.recordTokenUsageBatch([event({ eventKey: 'cc:a' })], '/tmp/session.jsonl', 3000, 4096);
    expect(again).toBe(0);
    expect(store.getTranscriptReadState('/tmp/session.jsonl')?.byteOffset).toBe(3000);
  });

  it('forgets a transcript when asked', () => {
    store.recordTokenUsageBatch([], '/tmp/gone.jsonl', 10, 10);
    expect(store.getTranscriptReadState('/tmp/gone.jsonl')).not.toBeNull();
    store.clearTranscriptReadState('/tmp/gone.jsonl');
    expect(store.getTranscriptReadState('/tmp/gone.jsonl')).toBeNull();
  });

  // The Stop hook carries no project, so token ingestion resolves it from the
  // session row init created. A NULL here makes the user's spend invisible to
  // the viewer's per-project Token Burn filter.
  it('resolves the project a content session was initialized with', () => {
    store.createSDKSession('cs-with-project', 'my-project', 'prompt', undefined, 'claude');
    expect(store.getProjectForContentSession('cs-with-project', 'claude')).toBe('my-project');

    // Wrong platform, unknown session, and a project never filled in all
    // answer NULL rather than guessing.
    expect(store.getProjectForContentSession('cs-with-project', 'codex')).toBeNull();
    expect(store.getProjectForContentSession('cs-unknown', 'claude')).toBeNull();
    store.createSDKSession('cs-no-project', '', 'prompt', undefined, 'claude');
    expect(store.getProjectForContentSession('cs-no-project', 'claude')).toBeNull();
  });

  it('re-running the constructor over the same database changes nothing', () => {
    store.recordTokenUsage(event());
    const reopened = new SessionStore(store.db);
    const rows = reopened.db.prepare('SELECT COUNT(*) AS n FROM token_usage_events').get() as { n: number };
    const versions = reopened.db.prepare('SELECT COUNT(*) AS n FROM schema_versions WHERE version = 50').get() as { n: number };
    expect(rows.n).toBe(1);
    expect(versions.n).toBe(1);
  });
});
