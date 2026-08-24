import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { ingestTranscriptUsage, usageEventFromLine } from '../../src/services/worker/token-usage/transcript-usage.js';

function assistantLine(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: overrides.uuid ?? 'uuid-1',
    requestId: overrides.requestId ?? 'req_1',
    timestamp: overrides.timestamp ?? '2026-06-01T05:00:00.000Z',
    isSidechain: overrides.isSidechain ?? false,
    message: {
      id: overrides.messageId ?? 'msg_1',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'SECRET CONVERSATION TEXT' }],
      usage: overrides.usage ?? {
        input_tokens: 2,
        cache_creation_input_tokens: 40225,
        cache_read_input_tokens: 190000,
        output_tokens: 174,
        output_tokens_details: { thinking_tokens: 38 },
      },
    },
  });
}

describe('transcript token usage ingestion', () => {
  let dir: string;
  let file: string;
  let store: SessionStore;

  const opts = () => ({
    transcriptPath: file,
    contentSessionId: 'cc-1',
    project: 'claude-mem',
    platformSource: 'claude',
    enabled: true,
  });

  function count(): number {
    return (store.db.prepare('SELECT COUNT(*) AS n FROM token_usage_events').get() as { n: number }).n;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claude-mem-burn-'));
    file = join(dir, 'session.jsonl');
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // THE regression this whole design exists for. A real 1709-line transcript
  // held only 1015 distinct message.ids: Claude Code repeats one response's
  // usage across up to five lines under different uuids. Keying on uuid
  // over-counted that transcript by 1.65x.
  it('counts one API response once even when it spans several lines', () => {
    writeFileSync(file, [
      assistantLine({ uuid: 'uuid-a' }),
      assistantLine({ uuid: 'uuid-b' }),
      assistantLine({ uuid: 'uuid-c' }),
      '',
    ].join('\n'));

    const result = ingestTranscriptUsage(store, opts());

    expect(result.inserted).toBe(1);
    expect(count()).toBe(1);
    const row = store.db.prepare('SELECT * FROM token_usage_events').get() as Record<string, any>;
    expect(row.cache_read_tokens).toBe(190000);
    expect(row.event_key).toBe('cc:msg_1');
  });

  it('does not re-read a transcript that has not grown', () => {
    writeFileSync(file, assistantLine() + '\n');
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(1);
    expect(ingestTranscriptUsage(store, opts()).skipped).toBe('up-to-date');
    expect(count()).toBe(1);
  });

  it('picks up only what was appended since the last pass', () => {
    writeFileSync(file, assistantLine({ messageId: 'msg_1' }) + '\n');
    ingestTranscriptUsage(store, opts());

    appendFileSync(file, assistantLine({ messageId: 'msg_2' }) + '\n');
    appendFileSync(file, assistantLine({ messageId: 'msg_3' }) + '\n');

    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(2);
    expect(count()).toBe(3);
  });

  // Claude Code is appending while we read. A line without its closing newline
  // is still being written; consuming it would persist a truncated turn.
  it('leaves a half-written trailing line for the next pass', () => {
    writeFileSync(file, assistantLine({ messageId: 'msg_1' }) + '\n' + '{"type":"assistant","mess');
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(1);

    // The rest of that line arrives.
    writeFileSync(file, assistantLine({ messageId: 'msg_1' }) + '\n' + assistantLine({ messageId: 'msg_2' }) + '\n');
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(1);
    expect(count()).toBe(2);
  });

  it('re-reads from the start when the file shrank underneath it', () => {
    writeFileSync(file, assistantLine({ messageId: 'msg_1' }) + '\n' + assistantLine({ messageId: 'msg_2' }) + '\n');
    ingestTranscriptUsage(store, opts());
    expect(count()).toBe(2);

    writeFileSync(file, assistantLine({ messageId: 'msg_3' }) + '\n');
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(1);
    expect(count()).toBe(3);
  });

  it('forgets a transcript that disappeared instead of erroring', () => {
    writeFileSync(file, assistantLine() + '\n');
    ingestTranscriptUsage(store, opts());
    expect(store.getTranscriptReadState(file)).not.toBeNull();

    unlinkSync(file);
    expect(ingestTranscriptUsage(store, opts()).skipped).toBe('missing');
    expect(store.getTranscriptReadState(file)).toBeNull();
  });

  it('skips malformed lines without abandoning the good ones', () => {
    writeFileSync(file, ['not json at all', assistantLine({ messageId: 'msg_ok' }), '{"broken":', ''].join('\n'));
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(1);
  });

  it('ignores user and system lines, which carry no usage', () => {
    writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'system', subtype: 'init' }),
      '',
    ].join('\n'));
    expect(ingestTranscriptUsage(store, opts()).inserted).toBe(0);
  });

  it('records subagent turns as user spend while keeping the flag', () => {
    writeFileSync(file, assistantLine({ messageId: 'msg_sub', isSidechain: true }) + '\n');
    ingestTranscriptUsage(store, opts());
    const row = store.db.prepare('SELECT source, is_sidechain FROM token_usage_events').get() as Record<string, any>;
    expect(row.source).toBe('user');
    expect(row.is_sidechain).toBe(1);
  });

  it('does not open the file when capture is switched off', () => {
    writeFileSync(file, assistantLine() + '\n');
    expect(ingestTranscriptUsage(store, { ...opts(), enabled: false }).skipped).toBe('disabled');
    expect(count()).toBe(0);
    expect(store.getTranscriptReadState(file)).toBeNull();
  });

  it('declines platforms whose transcripts have a different shape', () => {
    writeFileSync(file, assistantLine() + '\n');
    expect(ingestTranscriptUsage(store, { ...opts(), platformSource: 'codex' }).skipped).toBe('unsupported-platform');
    expect(count()).toBe(0);
  });

  it('leaves the user series without a cost rather than estimating one', () => {
    writeFileSync(file, assistantLine() + '\n');
    ingestTranscriptUsage(store, opts());
    expect((store.db.prepare('SELECT cost_usd FROM token_usage_events').get() as any).cost_usd).toBeNull();
  });

  it('dates a row from the transcript timestamp, not from now', () => {
    writeFileSync(file, assistantLine({ timestamp: '2026-06-01T05:00:00.000Z' }) + '\n');
    ingestTranscriptUsage(store, opts());
    const row = store.db.prepare('SELECT created_at_epoch FROM token_usage_events').get() as { created_at_epoch: number };
    expect(row.created_at_epoch).toBe(Date.parse('2026-06-01T05:00:00.000Z'));
  });

  // The transcript is handed to us to find the last assistant message. It must
  // not become a second copy of the conversation.
  it('never lets conversation text reach the database', () => {
    writeFileSync(file, assistantLine() + '\n');
    ingestTranscriptUsage(store, opts());

    const rows = store.db.prepare('SELECT * FROM token_usage_events').all() as Array<Record<string, unknown>>;
    // Assert on the stored VALUES, not on the serialized row: the column name
    // content_session_id contains "content" and would mask a real leak.
    const values = rows.flatMap(row => Object.values(row)).filter(v => typeof v === 'string') as string[];
    expect(values).not.toContain('SECRET CONVERSATION TEXT');
    expect(values.some(v => v.includes('SECRET'))).toBe(false);
    // Every stored string is one of a known, closed set of metadata fields.
    expect(values.sort()).toEqual([
      '2026-06-01T05:00:00.000Z', 'cc-1', 'cc:msg_1', 'claude', 'claude-mem', 'claude-opus-5', 'session', 'user',
    ].sort());
  });
});

describe('usageEventFromLine', () => {
  const ctx = { contentSessionId: 'cc-1', project: 'p', platformSource: 'claude' };

  it('prefers message.id over requestId and uuid', () => {
    const event = usageEventFromLine(assistantLine({ messageId: 'msg_x', requestId: 'req_y', uuid: 'uuid_z' }), ctx);
    expect(event?.eventKey).toBe('cc:msg_x');
  });

  it('falls back to requestId when the message carries no id', () => {
    const raw = JSON.stringify({
      type: 'assistant', requestId: 'req_y', uuid: 'uuid_z',
      message: { usage: { output_tokens: 1 } },
    });
    expect(usageEventFromLine(raw, ctx)?.eventKey).toBe('cc:req:req_y');
  });

  it('uses uuid only as a last resort', () => {
    const raw = JSON.stringify({ type: 'assistant', uuid: 'uuid_z', message: { usage: { output_tokens: 1 } } });
    expect(usageEventFromLine(raw, ctx)?.eventKey).toBe('cc:uuid:uuid_z');
  });

  it('returns nothing for a line with no identity at all', () => {
    const raw = JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 1 } } });
    expect(usageEventFromLine(raw, ctx)).toBeNull();
  });
});

describe('a transcript larger than one pass', () => {
  /**
   * The cap used to move the starting offset instead of bounding the length,
   * which dropped the head of the file and then advanced the watermark past it.
   * Found on a real 25MB transcript: 1,183 messages in the file, 822 in the
   * database, watermark parked at EOF as though the read had completed.
   */
  function bigTranscript(dir: string, lines: number): string {
    const path = join(dir, 'big.jsonl');
    const rows = Array.from({ length: lines }, (_, i) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        message: { id: `msg_${i}`, model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } },
      })
    );
    writeFileSync(path, rows.join('\n') + '\n');
    return path;
  }

  it('reads the head of the file rather than skipping to its tail', () => {
    const store = new SessionStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'burn-cap-'));
    const path = bigTranscript(dir, 40);

    const first = ingestTranscriptUsage(store, { transcriptPath: path, enabled: true, maxReadBytes: 400 });

    expect(first.inserted).toBeGreaterThan(0);
    const keys = store.db.prepare('SELECT event_key FROM token_usage_events ORDER BY id').all() as { event_key: string }[];
    // The very first message must be present: it is the one the old code threw away.
    expect(keys[0].event_key).toBe('cc:msg_0');
    store.close();
  });

  it('resumes where the pass stopped until the whole file is read', () => {
    const store = new SessionStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'burn-cap-'));
    const path = bigTranscript(dir, 40);

    let total = 0;
    for (let pass = 0; pass < 50; pass++) {
      const r = ingestTranscriptUsage(store, { transcriptPath: path, enabled: true, maxReadBytes: 400 });
      total += r.inserted;
      if (r.skipped === 'up-to-date') break;
    }

    expect(total).toBe(40);
    const seen = store.db.prepare('SELECT COUNT(DISTINCT event_key) AS n FROM token_usage_events').get() as { n: number };
    expect(seen.n).toBe(40);
    store.close();
  });
});
