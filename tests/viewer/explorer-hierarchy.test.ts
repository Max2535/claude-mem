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

  it('by time: day > block > prompt > observation once the lone session merges', () => {
    const root = buildHierarchy('2026-07-14', rows, 'time');
    expect(root.data.kind).toBe('day');
    expect(root.children).toHaveLength(2);

    const [first] = root.children;
    expect(first.data.kind).toBe('block');
    // The block keeps its id — Locate addresses it by that exact string — and
    // takes the session's title, with the time range moved to the tooltip.
    expect(first.id).toBe('day-2026-07-14-b0');
    expect(first.data.label).toBe('Observation 1');
    expect(first.data.hint).toMatch(/\d\d:\d\d – \d\d:\d\d/);
    expect(first.children[0].data.kind).toBe('prompt');
    expect(first.children[0].children[0].data.kind).toBe('observation');
    expect(first.children[0].children[0].data.observationId).toBe(1);
  });

  it('keeps the session tier when a block really holds more than one', () => {
    const shared = [
      row({ id: 1, createdAt: base, contentSessionId: 'content-1' }),
      row({ id: 2, createdAt: base + 1000, contentSessionId: 'content-2' }),
    ];
    const [block] = buildHierarchy('2026-07-14', shared, 'time').children;
    expect(block.children.map(c => c.data.kind)).toEqual(['session', 'session']);
    expect(block.data.hint).toBeUndefined();
  });

  it('by app: the project keeps the label and the merged session becomes the hint', () => {
    const root = buildHierarchy('2026-07-14', rows, 'app');
    expect(root.children.map(c => c.data.label)).toEqual(['max', 'other']);
    expect(root.children[0].data.hint).toBe('Observation 1');
    expect(root.children[0].children[0].data.kind).toBe('prompt');
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
