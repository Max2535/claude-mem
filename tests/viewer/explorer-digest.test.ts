import { describe, it, expect } from 'bun:test';
import { buildDayDigest } from '../../src/ui/viewer/utils/explorerDigest.js';
import { BLOCK_GAP_MS } from '../../src/ui/viewer/utils/explorerHierarchy.js';
import type { ExplorerDayObservation } from '../../src/ui/viewer/types.js';

const base = Date.UTC(2026, 6, 14, 9, 0, 0);

function row(over: Partial<ExplorerDayObservation> & { id: number; createdAt: number }): ExplorerDayObservation {
  return {
    sessionId: 'mem-1',
    contentSessionId: 'content-1',
    project: 'max',
    platformSource: 'claude',
    type: 'discovery',
    title: `Observation ${over.id}`,
    subtitle: null,
    promptNumber: 1,
    ...over,
  };
}

describe('buildDayDigest', () => {
  it('gives an all-zero digest for an empty day rather than throwing', () => {
    const digest = buildDayDigest([]);
    expect(digest.total).toBe(0);
    expect(digest.span).toBeNull();
    expect(digest.busiest).toBeNull();
    expect(digest.types).toEqual([]);
  });

  it('counts a turn once per session, not once per prompt number', () => {
    // The same prompt number in two sessions is two turns; twice in one
    // session is one.
    const rows = [
      row({ id: 1, createdAt: base, contentSessionId: 'a', promptNumber: 1 }),
      row({ id: 2, createdAt: base + 1000, contentSessionId: 'a', promptNumber: 1 }),
      row({ id: 3, createdAt: base + 2000, contentSessionId: 'b', promptNumber: 1 }),
    ];
    const digest = buildDayDigest(rows);
    expect(digest.sessions).toBe(2);
    expect(digest.prompts).toBe(2);
  });

  it('ignores rows with no prompt number when counting turns', () => {
    const rows = [
      row({ id: 1, createdAt: base, promptNumber: null }),
      row({ id: 2, createdAt: base + 1000, promptNumber: 4 }),
    ];
    expect(buildDayDigest(rows).prompts).toBe(1);
  });

  it('orders a tally by count and breaks ties by name', () => {
    const rows = [
      row({ id: 1, createdAt: base, type: 'bugfix' }),
      row({ id: 2, createdAt: base + 1000, type: 'feature' }),
      row({ id: 3, createdAt: base + 2000, type: 'feature' }),
      row({ id: 4, createdAt: base + 3000, type: 'audit' }),
    ];
    expect(buildDayDigest(rows).types).toEqual([
      { name: 'feature', count: 2 },
      { name: 'audit', count: 1 },
      { name: 'bugfix', count: 1 },
    ]);
  });

  it('spans first to last observation whatever order the rows arrive in', () => {
    const rows = [
      row({ id: 1, createdAt: base + 5000 }),
      row({ id: 2, createdAt: base }),
      row({ id: 3, createdAt: base + 2000 }),
    ];
    expect(buildDayDigest(rows).span).toEqual({ start: base, end: base + 5000 });
  });

  it('picks the busiest block by the same gap rule the tree uses', () => {
    const second = base + BLOCK_GAP_MS + 1;
    const rows = [
      row({ id: 1, createdAt: base }),
      row({ id: 2, createdAt: second }),
      row({ id: 3, createdAt: second + 1000 }),
      row({ id: 4, createdAt: second + 2000 }),
    ];
    const digest = buildDayDigest(rows);
    expect(digest.blocks).toBe(2);
    expect(digest.busiest).toEqual({ start: second, end: second + 2000, count: 3 });
  });

  it('falls back to claude for a row with no platform source', () => {
    const rows = [row({ id: 1, createdAt: base, platformSource: '' })];
    expect(buildDayDigest(rows).sources).toEqual([{ name: 'claude', count: 1 }]);
  });
});
