import { describe, it, expect } from 'bun:test';
import {
  describeWalk,
  plural,
  readKeywordResponse,
  readWalkResponse,
  unmatchedSources,
} from '../../src/ui/viewer/utils/memoryWalk.js';
import type { MemoryWalkTraversal } from '../../src/ui/viewer/types.js';

describe('readWalkResponse', () => {
  it('treats a 200 carrying an error as a fallback, not a walk', () => {
    // The disabled endpoint answers 200 — response.ok alone would call this success.
    const outcome = readWalkResponse(true, 200, {
      error: 'Vectorless retrieval is disabled',
      hint: 'Set CLAUDE_MEM_VECTORLESS_ENABLED=true in ~/.claude-mem/settings.json and restart the worker',
    });
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.note).toContain('Vectorless retrieval is disabled');
    expect(outcome.note).toContain('CLAUDE_MEM_VECTORLESS_ENABLED=true');
  });

  it('falls back with the status when the request itself failed', () => {
    const outcome = readWalkResponse(false, 500, null);
    expect(outcome.kind).toBe('fallback');
    if (outcome.kind !== 'fallback') return;
    expect(outcome.note).toContain('500');
  });

  it('falls back with no note when the body is unreadable', () => {
    const outcome = readWalkResponse(true, 200, null);
    expect(outcome).toEqual({ kind: 'fallback', note: undefined });
  });

  it('reports a walk when the body carries one', () => {
    const traversal: MemoryWalkTraversal = { rounds: 2, daysWalked: ['2026-07-14'], sessionsWalked: ['s1'], indexRows: 80 };
    const outcome = readWalkResponse(true, 200, {
      observations: [{ id: 1 } as never],
      traversal,
      coverage: { indexed: { claude: 80 }, matched: { claude: 1 } },
      strategy: 'vectorless',
    });
    expect(outcome.kind).toBe('walk');
    if (outcome.kind !== 'walk') return;
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.traversal).toEqual(traversal);
  });

  it('treats a walk that matched nothing as a walk, not a fallback', () => {
    const outcome = readWalkResponse(true, 200, {
      observations: [],
      traversal: { rounds: 1, daysWalked: [], sessionsWalked: [], indexRows: 0 },
    });
    expect(outcome.kind).toBe('walk');
  });
});

describe('readKeywordResponse', () => {
  it('counts what it drops so the screen can say so', () => {
    const { observations, omitted } = readKeywordResponse({
      observations: [{ id: 1 } as never, { id: 2 } as never],
      sessions: [{} as never],
      prompts: [{} as never, {} as never],
      totalResults: 5,
    });
    expect(observations).toHaveLength(2);
    expect(omitted).toEqual({ sessions: 1, prompts: 2 });
  });

  it('survives a body missing every array', () => {
    expect(readKeywordResponse(null)).toEqual({ observations: [], omitted: { sessions: 0, prompts: 0 } });
  });
});

describe('describeWalk', () => {
  it('says plainly that no day narrowing ran when rounds is 1', () => {
    const steps = describeWalk({ rounds: 1, daysWalked: ['a', 'b'], sessionsWalked: ['s'], indexRows: 81 }, 6);
    expect(steps.map(s => s.label)).toEqual(['Built the index', 'Skipped day narrowing', 'Picked the answers']);
    expect(steps[1].detail).toContain('2 days');
    expect(steps[0].detail).toContain('81 observations');
    expect(steps[2].detail).toContain('6 observations');
  });

  it('reports the days it kept when a second round ran', () => {
    const steps = describeWalk({ rounds: 2, daysWalked: ['2026-07-14'], sessionsWalked: ['s'], indexRows: 500 }, 1);
    expect(steps[1].label).toBe('Narrowed to days');
    expect(steps[1].detail).toContain('2026-07-14');
    // One of each: the singular must not read "1 observations".
    expect(steps[2].detail).toBe('1 observation across 1 session.');
  });
});

describe('unmatchedSources', () => {
  it('names a source that was indexed but never picked', () => {
    expect(unmatchedSources({ indexed: { claude: 40, codex: 3 }, matched: { claude: 2 } })).toEqual(['codex']);
  });

  it('is empty when every indexed source matched', () => {
    expect(unmatchedSources({ indexed: { claude: 40 }, matched: { claude: 2 } })).toEqual([]);
  });
});

describe('plural', () => {
  it('drops the s at one and takes an irregular plural when given one', () => {
    expect(plural(1, 'observation')).toBe('1 observation');
    expect(plural(2, 'observation')).toBe('2 observations');
    expect(plural(1, 'session summary', 'session summaries')).toBe('1 session summary');
    expect(plural(3, 'session summary', 'session summaries')).toBe('3 session summaries');
  });
});
