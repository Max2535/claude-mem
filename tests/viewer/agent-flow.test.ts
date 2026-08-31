import { describe, expect, it } from 'bun:test';
import type { AgentFlowEvent } from '../../src/ui/viewer/types';
import {
  FLOW_EVENT_LIMIT,
  filterFlowByProject,
  flowNodeOf,
  formatDuration,
  formatFlowTime,
  matchesFilter,
  mergeFlowEvents,
  nodeKindForStage,
  queueLatencyMs,
  shortSessionId,
  stageLabel,
  toChartOrder,
} from '../../src/ui/viewer/utils/agentFlow';

function evt(overrides: Partial<AgentFlowEvent> & { seq: number }): AgentFlowEvent {
  return {
    stage: 'hook_received',
    at: 1_000,
    project: 'demo',
    contentSessionId: 'cs-1',
    sessionDbId: null,
    detail: null,
    outcome: null,
    ...overrides,
  };
}

describe('mergeFlowEvents', () => {
  it('orders newest first by timestamp, breaking millisecond ties on seq', () => {
    const merged = mergeFlowEvents([], [
      evt({ seq: 1, at: 5_000 }),
      evt({ seq: 2, at: 1_000 }),
      evt({ seq: 3, at: 1_000 }),
    ]);

    expect(merged.map(e => e.seq)).toEqual([1, 3, 2]);
  });

  it('sorts post-restart events above the surviving pre-restart stream', () => {
    // A worker restart resets seq to 1. Ordering on seq alone pinned the dead
    // stream (high seq) to the top of the screen until FLOW_EVENT_LIMIT new
    // events pushed it out.
    const beforeRestart = mergeFlowEvents([], [
      evt({ seq: 201, at: 10_000, detail: 'old' }),
      evt({ seq: 202, at: 11_000, detail: 'old' }),
    ]);
    const merged = mergeFlowEvents(beforeRestart, [
      evt({ seq: 1, at: 20_000, detail: 'new' }),
      evt({ seq: 2, at: 21_000, detail: 'new' }),
    ]);

    expect(merged.map(e => e.detail)).toEqual(['new', 'new', 'old', 'old']);
    expect(merged[0].seq).toBe(2);
  });

  it('drops duplicates when a reconnect replays the ring', () => {
    const existing = mergeFlowEvents([], [evt({ seq: 1 }), evt({ seq: 2 })]);
    const merged = mergeFlowEvents(existing, [evt({ seq: 2 }), evt({ seq: 3 })]);

    expect(merged.map(e => e.seq)).toEqual([3, 2, 1]);
  });

  it('lets the incoming copy win, so a post-restart seq is not swallowed', () => {
    const existing = mergeFlowEvents([], [evt({ seq: 1, detail: 'before restart' })]);
    const merged = mergeFlowEvents(existing, [evt({ seq: 1, detail: 'after restart' })]);

    expect(merged).toHaveLength(1);
    expect(merged[0].detail).toBe('after restart');
  });

  it('caps the stream and keeps the newest', () => {
    const many = Array.from({ length: FLOW_EVENT_LIMIT + 25 }, (_, i) => evt({ seq: i + 1 }));
    const merged = mergeFlowEvents([], many);

    expect(merged).toHaveLength(FLOW_EVENT_LIMIT);
    expect(merged[0].seq).toBe(FLOW_EVENT_LIMIT + 25);
  });

  it('returns the existing array untouched for an empty batch', () => {
    const existing = mergeFlowEvents([], [evt({ seq: 1 })]);
    expect(mergeFlowEvents(existing, [])).toBe(existing);
  });
});

describe('queueLatencyMs', () => {
  it('measures from the matching queue event of the same session', () => {
    const events = mergeFlowEvents([], [
      evt({ seq: 1, stage: 'observation_queued', at: 1_000 }),
      evt({ seq: 2, stage: 'compression_finished', at: 3_500 }),
    ]);

    expect(queueLatencyMs(events, events[0])).toBe(2_500);
  });

  it('ignores a queue event belonging to another session', () => {
    const events = mergeFlowEvents([], [
      evt({ seq: 1, stage: 'observation_queued', at: 1_000, contentSessionId: 'other' }),
      evt({ seq: 2, stage: 'compression_finished', at: 3_500, contentSessionId: 'cs-1' }),
    ]);

    expect(queueLatencyMs(events, events[0])).toBeNull();
  });

  it('returns null rather than guessing when the queue event predates the stream', () => {
    const events = mergeFlowEvents([], [
      evt({ seq: 9, stage: 'compression_finished', at: 3_500 }),
    ]);

    expect(queueLatencyMs(events, events[0])).toBeNull();
  });

  it('only applies to compression_finished', () => {
    const events = mergeFlowEvents([], [
      evt({ seq: 1, stage: 'observation_queued', at: 1_000 }),
      evt({ seq: 2, stage: 'observation_written', at: 3_500 }),
    ]);

    expect(queueLatencyMs(events, events[0])).toBeNull();
  });
});

describe('formatting and filtering', () => {
  it('formats sub-second and multi-second durations differently', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(2_500)).toBe('2.5s');
  });

  it('formats time at second resolution with zero padding', () => {
    const at = new Date(2026, 7, 23, 9, 5, 4).getTime();
    expect(formatFlowTime(at)).toBe('09:05:04');
  });

  it('names every stage in words so colour is never the only cue', () => {
    expect(stageLabel('compression_finished')).toBe('Observer');
    expect(stageLabel('context_injected')).toBe('Context injected');
  });

  it('passes everything through when no project is selected', () => {
    const events = [evt({ seq: 1, project: 'a' }), evt({ seq: 2, project: 'b' })];
    expect(filterFlowByProject(events, null)).toHaveLength(2);
    expect(filterFlowByProject(events, 'a').map(e => e.seq)).toEqual([1]);
  });
});

describe('nodeKindForStage', () => {
  it('maps every stage to a node kind — no stage falls through unlabelled', () => {
    expect(nodeKindForStage('compression_finished')).toBe('model');
    expect(nodeKindForStage('hook_received')).toBe('tool');
    expect(nodeKindForStage('observation_queued')).toBe('tool');
    expect(nodeKindForStage('observation_written')).toBe('output');
    expect(nodeKindForStage('summary_written')).toBe('output');
    expect(nodeKindForStage('context_injected')).toBe('output');
    expect(nodeKindForStage('session_started')).toBe('marker');
    expect(nodeKindForStage('session_completed')).toBe('marker');
  });
});

describe('flowNodeOf', () => {
  it('splits an observer detail into model line and run stats', () => {
    const node = flowNodeOf(
      evt({ seq: 1, stage: 'compression_finished', detail: 'SDK · 3 observations', outcome: 'ok' }),
      2_500
    );

    expect(node.kind).toBe('model');
    expect(node.title).toBe('SDK');
    expect(node.subtitle).toBe('3 observations · 2.5s after queue');
  });

  it('handles an observer detail with no separator', () => {
    const node = flowNodeOf(
      evt({ seq: 1, stage: 'compression_finished', detail: 'SDK', outcome: 'idle' }),
      null
    );

    expect(node.title).toBe('SDK');
    expect(node.subtitle).toBe('');
  });

  it('puts the stage label above the produced text on an output node', () => {
    const node = flowNodeOf(
      evt({ seq: 1, stage: 'context_injected', detail: 'context · 4294 chars', outcome: 'ok' }),
      null
    );

    expect(node.kind).toBe('output');
    expect(node.title).toBe('Context injected');
    expect(node.subtitle).toBe('context · 4294 chars');
  });

  it('falls back to the stage label when a tool node carries no detail', () => {
    const node = flowNodeOf(evt({ seq: 1, stage: 'observation_queued' }), null);

    expect(node.title).toBe('Queued');
  });

  it('flags an error whatever the node kind, without hiding the outcome word', () => {
    const model = flowNodeOf(
      evt({ seq: 1, stage: 'compression_finished', detail: 'SDK quota limit', outcome: 'error' }),
      null
    );
    const tool = flowNodeOf(
      evt({ seq: 2, stage: 'hook_received', detail: 'summarize', outcome: 'error' }),
      null
    );

    expect(model.isError).toBe(true);
    expect(tool.isError).toBe(true);
    expect(tool.subtitle).toContain('error');
  });

  it('leaves a healthy node unflagged', () => {
    const node = flowNodeOf(evt({ seq: 1, stage: 'hook_received', outcome: 'ok' }), null);
    expect(node.isError).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('matches on stage label, detail, project and outcome', () => {
    const event = evt({ seq: 1, stage: 'compression_finished', detail: 'SDK idle', project: 'widgets', outcome: 'idle' });

    expect(matchesFilter(event, 'observer')).toBe(true);
    expect(matchesFilter(event, 'sdk')).toBe(true);
    expect(matchesFilter(event, 'WIDGETS')).toBe(true);
    expect(matchesFilter(event, 'idle')).toBe(true);
    expect(matchesFilter(event, 'summary')).toBe(false);
  });

  it('treats an empty or whitespace query as no filter at all', () => {
    const event = evt({ seq: 1 });
    expect(matchesFilter(event, '')).toBe(true);
    expect(matchesFilter(event, '   ')).toBe(true);
  });
});

describe('chart ordering and crumbs', () => {
  it('reverses state order so the chart reads downward through time', () => {
    const state = mergeFlowEvents([], [evt({ seq: 1 }), evt({ seq: 2 }), evt({ seq: 3 })]);

    expect(state.map(e => e.seq)).toEqual([3, 2, 1]);
    expect(toChartOrder(state).map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('does not mutate the array it was given', () => {
    const state = mergeFlowEvents([], [evt({ seq: 1 }), evt({ seq: 2 })]);
    toChartOrder(state);

    expect(state.map(e => e.seq)).toEqual([2, 1]);
  });

  it('shortens a session id and says so when there is none', () => {
    expect(shortSessionId('ee0b3a5a-da25-4917-8350-7c45647d315d')).toBe('ee0b3a5a');
    expect(shortSessionId('abc')).toBe('abc');
    expect(shortSessionId(null)).toBe('no session');
  });
});
