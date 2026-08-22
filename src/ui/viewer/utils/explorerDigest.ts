import type { ExplorerDayObservation } from '../types.js';
import { splitIntoBlocks } from './explorerHierarchy.js';

export interface DigestTally {
  name: string;
  count: number;
}

export interface DigestBlock {
  start: number;
  end: number;
  count: number;
}

export interface DayDigest {
  total: number;
  /** Distinct content sessions — the conversations, not the memory rows. */
  sessions: number;
  /** Distinct (session, prompt number) pairs: how many turns produced memory. */
  prompts: number;
  types: DigestTally[];
  projects: DigestTally[];
  sources: DigestTally[];
  /** First and last observation of the day, or null on an empty day. */
  span: { start: number; end: number } | null;
  blocks: number;
  /** The single busiest stretch of work, by the same gap rule as the tree. */
  busiest: DigestBlock | null;
}

/** Descending by count, then by name, so the order never depends on row order. */
function tally(values: string[]): DigestTally[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The day in numbers, built entirely from what /api/explorer/day already
 * returns. There is no digest endpoint and no model call here: every figure is
 * counted from the rows the tree is drawing, so the two tabs can never
 * disagree about the same day.
 */
export function buildDayDigest(observations: ExplorerDayObservation[]): DayDigest {
  if (observations.length === 0) {
    return { total: 0, sessions: 0, prompts: 0, types: [], projects: [], sources: [], span: null, blocks: 0, busiest: null };
  }

  const epochs = observations.map(o => o.createdAt);
  const blocks = splitIntoBlocks(observations);
  const busiestBlock = blocks.reduce((best, block) => (block.length > best.length ? block : best), blocks[0]);

  return {
    total: observations.length,
    sessions: new Set(observations.map(o => o.contentSessionId)).size,
    // A prompt number repeats across sessions, so it only identifies a turn
    // when paired with the session it belongs to.
    prompts: new Set(
      observations
        .filter(o => o.promptNumber !== null)
        .map(o => `${o.contentSessionId}#${o.promptNumber}`)
    ).size,
    types: tally(observations.map(o => o.type)),
    projects: tally(observations.map(o => o.project)),
    sources: tally(observations.map(o => o.platformSource || 'claude')),
    span: { start: Math.min(...epochs), end: Math.max(...epochs) },
    blocks: blocks.length,
    busiest: {
      start: busiestBlock[0].createdAt,
      end: busiestBlock[busiestBlock.length - 1].createdAt,
      count: busiestBlock.length,
    },
  };
}
