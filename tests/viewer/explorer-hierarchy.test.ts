import { describe, it, expect } from 'bun:test';
import { buildHierarchy, splitIntoBlocks, BLOCK_GAP_MS } from '../../src/ui/viewer/utils/explorerHierarchy.js';
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

describe('splitIntoBlocks', () => {
  it('keeps observations closer together than the gap in one block', () => {
    const rows = [row({ id: 1, createdAt: base }), row({ id: 2, createdAt: base + BLOCK_GAP_MS - 1 })];
    expect(splitIntoBlocks(rows).map(b => b.length)).toEqual([2]);
  });

  it('starts a new block once the gap is exceeded', () => {
    const rows = [row({ id: 1, createdAt: base }), row({ id: 2, createdAt: base + BLOCK_GAP_MS + 1 })];
    expect(splitIntoBlocks(rows).map(b => b.length)).toEqual([1, 1]);
  });

  it('measures the gap from the previous observation, not the block start', () => {
    // Three observations 20 minutes apart span an hour but never idle for 30.
    const step = 20 * 60 * 1000;
    const rows = [1, 2, 3].map(i => row({ id: i, createdAt: base + (i - 1) * step }));
    expect(splitIntoBlocks(rows).map(b => b.length)).toEqual([3]);
  });

  it('returns nothing for no rows', () => {
    expect(splitIntoBlocks([])).toEqual([]);
  });
});

describe('buildHierarchy', () => {
  const rows = [
    row({ id: 1, createdAt: base, promptNumber: 1 }),
    row({ id: 2, createdAt: base + 1000, promptNumber: 2 }),
    row({ id: 3, createdAt: base + BLOCK_GAP_MS + 5000, promptNumber: 3, contentSessionId: 'content-2', project: 'other' }),
  ];

  it('by time: day > block > session > prompt > observation', () => {
    const root = buildHierarchy('2026-07-14', rows, 'time');
    expect(root.data.kind).toBe('day');
    expect(root.children).toHaveLength(2);

    const [first] = root.children;
    expect(first.data.kind).toBe('block');
    expect(first.data.label).toMatch(/\d\d:\d\d – \d\d:\d\d/);
    expect(first.children[0].data.kind).toBe('session');
    expect(first.children[0].children[0].data.kind).toBe('prompt');
    expect(first.children[0].children[0].children[0].data.kind).toBe('observation');
    expect(first.children[0].children[0].children[0].data.observationId).toBe(1);
  });

  it('by app: the second tier is the project, and the rest is unchanged', () => {
    const root = buildHierarchy('2026-07-14', rows, 'app');
    expect(root.children.map(c => c.data.label)).toEqual(['max', 'other']);
    expect(root.children[0].children[0].data.kind).toBe('session');
  });

  it('counts every observation once at the root regardless of mode', () => {
    for (const mode of ['time', 'app'] as const) {
      expect(buildHierarchy('2026-07-14', rows, mode).data.count).toBe(3);
    }
  });

  it('gives a childless root for an empty day', () => {
    const root = buildHierarchy('2026-07-14', [], 'time');
    expect(root.children).toEqual([]);
    expect(root.data.count).toBe(0);
  });
});
