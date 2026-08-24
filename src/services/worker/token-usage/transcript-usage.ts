import { existsSync, statSync, readSync, openSync, closeSync } from 'fs';
import { logger } from '../../../utils/logger.js';
import type { SessionStore } from '../../sqlite/SessionStore.js';
import type { TokenUsageEvent } from '../../sqlite/types.js';

/**
 * Reads token usage out of a Claude Code transcript.
 *
 * ONLY usage metadata is read. `message.content` is never parsed, stored, or
 * logged — the transcript is handed to us for a different purpose, and this
 * reader must not become a second copy of the user's conversation.
 *
 * The tail is byte-offset based, mirroring services/transcripts/watcher.ts,
 * except the watermark lives in SQLite so rows and offset advance in one
 * transaction. A crash must re-read, never skip.
 */

/** How much of a transcript to read in one pass. A long idle gap can leave megabytes unread. */
const MAX_READ_BYTES = 16 * 1024 * 1024;

interface TranscriptLine {
  type?: string;
  uuid?: string;
  requestId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { thinking_tokens?: number };
    };
  };
}

export interface IngestOptions {
  transcriptPath: string;
  contentSessionId?: string | null;
  project?: string | null;
  platformSource?: string;
  /** When false the transcript is not opened at all. */
  enabled: boolean;
  /**
   * Bytes to read in one pass. Overridable so the cap can be exercised by a
   * test without writing a 16MB fixture — the path that loses data is the one
   * that only runs on files bigger than the cap.
   */
  maxReadBytes?: number;
}

export interface IngestResult {
  /** Rows newly persisted. Zero is the normal steady state between turns. */
  inserted: number;
  /** Why nothing was read, for logs. */
  skipped?: 'disabled' | 'unsupported-platform' | 'missing' | 'up-to-date' | 'no-path';
}

/**
 * The idempotency key for one transcript line.
 *
 * MUST prefer `message.id`. Claude Code writes a single API response across up
 * to five JSONL lines that repeat the same `message.usage` under distinct
 * `uuid`s; keying on uuid over-counted a real 1709-line transcript by 1.65x.
 * A resumed or forked session likewise re-emits prior turns with fresh uuids
 * but the same message ids, and the UNIQUE index absorbs them.
 *
 * requestId is the fallback; uuid is a last resort that WILL over-count, and
 * is used only so a line is never silently dropped.
 */
export function usageEventKey(line: TranscriptLine): { key: string; exact: boolean } | null {
  if (line.message?.id) return { key: `cc:${line.message.id}`, exact: true };
  if (line.requestId) return { key: `cc:req:${line.requestId}`, exact: true };
  if (line.uuid) return { key: `cc:uuid:${line.uuid}`, exact: false };
  return null;
}

/** Parses one JSONL line into an event, or null if it carries no usage. */
export function usageEventFromLine(
  raw: string,
  context: { contentSessionId?: string | null; project?: string | null; platformSource?: string }
): TokenUsageEvent | null {
  let line: TranscriptLine;
  try {
    line = JSON.parse(raw) as TranscriptLine;
  } catch {
    // A half-written or corrupt line is expected while Claude Code is running.
    return null;
  }

  if (line.type !== 'assistant') return null;
  const usage = line.message?.usage;
  if (!usage) return null;

  const keyed = usageEventKey(line);
  if (!keyed) return null;
  if (!keyed.exact) {
    logger.debug('WORKER', 'Transcript line had no message id — usage may over-count', {});
  }

  const timestamp = line.timestamp ? Date.parse(line.timestamp) : NaN;

  return {
    eventKey: keyed.key,
    source: 'user',
    component: 'session',
    platformSource: context.platformSource,
    project: context.project ?? null,
    contentSessionId: context.contentSessionId ?? null,
    model: line.message?.model ?? null,
    inputTokens: usage.input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    // The transcript never reports a price. Leaving this NULL is the whole
    // reason the user series has no cost line — estimating one from a
    // hardcoded price table would be a number nobody could audit.
    costUsd: null,
    // Subagent turns are real spend on the same bill, so they count toward the
    // user series. The flag is kept so a later view can split them out.
    isSidechain: line.isSidechain === true,
    epoch: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
}

/**
 * Reads whatever is new in one transcript and persists its usage rows.
 *
 * Never throws: it runs fire-and-forget off the Stop hook, and a summarize
 * request must not fail because a transcript moved.
 */
export function ingestTranscriptUsage(store: SessionStore, options: IngestOptions): IngestResult {
  const { transcriptPath, enabled } = options;
  if (!enabled) return { inserted: 0, skipped: 'disabled' };
  if (!transcriptPath) return { inserted: 0, skipped: 'no-path' };
  // Codex and Cursor write different JSONL shapes. An absent series is honest;
  // a guessed one is not.
  if ((options.platformSource ?? 'claude') !== 'claude') {
    return { inserted: 0, skipped: 'unsupported-platform' };
  }

  try {
    if (!existsSync(transcriptPath)) {
      store.clearTranscriptReadState(transcriptPath);
      return { inserted: 0, skipped: 'missing' };
    }

    const size = statSync(transcriptPath).size;
    const state = store.getTranscriptReadState(transcriptPath);
    // A file shorter than the watermark was truncated or replaced; re-read it
    // whole. Duplicate rows are impossible, so a full re-read is only wasted
    // I/O, while trusting a stale offset would lose turns forever.
    const offset = state && size >= state.byteOffset ? state.byteOffset : 0;
    if (size === offset) return { inserted: 0, skipped: 'up-to-date' };

    // Cap the LENGTH read, never the starting offset. Moving `offset` forward
    // to `size - MAX_READ_BYTES` discarded the head of any file bigger than the
    // cap and then advanced the watermark past it, losing those turns forever:
    // a real 25MB transcript lost 361 of its 1,183 messages that way. Whatever
    // this pass does not reach stays unread for the next one.
    const cap = options.maxReadBytes ?? MAX_READ_BYTES;
    const length = Math.min(size - offset, cap);
    const chunk = readRange(transcriptPath, offset, length);
    const text = chunk.toString('utf8');
    const lines = text.split('\n');
    // The final element is whatever follows the last newline: either a line
    // Claude Code is still writing, or — when this pass hit the cap — a
    // complete line that simply fell outside it. Never consume it; the next
    // pass re-reads from its start.
    const partial = lines.pop() ?? '';
    let nextOffset = offset + length - Buffer.byteLength(partial, 'utf8');
    // A single line longer than the cap would leave the watermark where it
    // started and spin forever. It cannot be parsed in one pass anyway, so step
    // over it and say so rather than stall.
    if (nextOffset <= offset) {
      logger.warn('WORKER', 'Transcript line exceeds the read cap — skipping it', { transcriptPath });
      nextOffset = offset + length;
    }

    const events: TokenUsageEvent[] = [];
    for (const line of lines) {
      if (!line) continue;
      const event = usageEventFromLine(line, options);
      if (event) events.push(event);
    }

    const inserted = store.recordTokenUsageBatch(events, transcriptPath, nextOffset, size);
    return { inserted };
  } catch (error) {
    logger.warn(
      'WORKER',
      'Transcript token usage not ingested — continuing',
      { transcriptPath },
      error instanceof Error ? error : new Error(String(error))
    );
    return { inserted: 0 };
  }
}

function readRange(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, offset + read);
      if (n <= 0) break;
      read += n;
    }
    return read === length ? buffer : buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}
