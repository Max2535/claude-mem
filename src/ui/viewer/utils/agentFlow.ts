import type { AgentFlowEvent, AgentFlowStage } from '../types';

/**
 * Cap the client-side stream.
 *
 * Larger than the worker's ring on purpose: a viewer left open all day
 * accumulates far more than one replay's worth, and this is the only place that
 * history exists. Agent Flow is live-only by design — nothing here is persisted,
 * so past this cap the oldest events are simply gone.
 */
export const FLOW_EVENT_LIMIT = 500;

/**
 * Merge new events into the stream, newest first.
 *
 * Deduped on `seq` because a reconnect replays the worker's ring, which
 * overlaps whatever the previous connection already delivered. Timestamps
 * collide at millisecond resolution and cannot serve as the key.
 *
 * A worker restart resets `seq` to 1, so a replayed low seq can legitimately be
 * a *new* event. That is why the incoming batch wins on collision rather than
 * being discarded — a stale duplicate and a post-restart event look identical,
 * and keeping the newer arrival is right in both cases.
 */
export function mergeFlowEvents(
  existing: AgentFlowEvent[],
  incoming: AgentFlowEvent[]
): AgentFlowEvent[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map<number, AgentFlowEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, FLOW_EVENT_LIMIT);
}

/** Human labels. Kept out of the component so the wording is testable. */
export const STAGE_LABELS: Record<AgentFlowStage, string> = {
  hook_received: 'Hook',
  session_started: 'Session started',
  observation_queued: 'Queued',
  compression_finished: 'Observer',
  observation_written: 'Observation',
  summary_written: 'Summary',
  context_injected: 'Context injected',
  session_completed: 'Session done',
};

export function stageLabel(stage: AgentFlowStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Clock time at second resolution — flow events are seconds apart, not days. */
export function formatFlowTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Elapsed time from the matching `observation_queued` to this
 * `compression_finished`, in ms.
 *
 * Computed from two real event timestamps rather than reported by the worker:
 * no single call site inside the observer brackets the model call, so a
 * "duration" field there would have been an estimate. Returns null when the
 * queue event predates the stream — a missing number, never a guessed one.
 *
 * `events` must be newest-first, as held in state.
 */
export function queueLatencyMs(
  events: AgentFlowEvent[],
  finished: AgentFlowEvent
): number | null {
  if (finished.stage !== 'compression_finished') return null;
  const startIndex = events.findIndex(e => e.seq === finished.seq);
  if (startIndex < 0) return null;
  for (let i = startIndex + 1; i < events.length; i++) {
    const candidate = events[i];
    if (
      candidate.stage === 'observation_queued' &&
      candidate.contentSessionId === finished.contentSessionId
    ) {
      const delta = finished.at - candidate.at;
      return delta >= 0 ? delta : null;
    }
  }
  return null;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Filter to one project. `null` means "everything". */
export function filterFlowByProject(
  events: AgentFlowEvent[],
  project: string | null
): AgentFlowEvent[] {
  if (!project) return events;
  return events.filter(e => e.project === project);
}

/**
 * Node shapes on the flow chart, borrowed from the reference the screen is
 * modelled on: a model call, a tool result, a block of produced text, and a
 * plain lifecycle marker. Four shapes for eight stages — the stage name is
 * still printed on every node, so nothing depends on the grouping being
 * guessable from the box alone.
 */
export type FlowNodeKind = 'model' | 'tool' | 'output' | 'marker';

const STAGE_NODE_KINDS: Record<AgentFlowStage, FlowNodeKind> = {
  compression_finished: 'model',
  hook_received: 'tool',
  observation_queued: 'tool',
  observation_written: 'output',
  summary_written: 'output',
  context_injected: 'output',
  session_started: 'marker',
  session_completed: 'marker',
};

export function nodeKindForStage(stage: AgentFlowStage): FlowNodeKind {
  return STAGE_NODE_KINDS[stage] ?? 'marker';
}

export interface FlowNode {
  kind: FlowNodeKind;
  /** The bold first line. */
  title: string;
  /** The dim second line. Empty string renders no second line at all. */
  subtitle: string;
  /**
   * True when this event failed, whatever its kind. Drawn as an error border
   * *in addition to* the outcome word, never instead of it — a red box with no
   * text would put the whole signal in colour.
   */
  isError: boolean;
}

/**
 * Turn one event into the two lines a node shows.
 *
 * `compression_finished` splits its detail because the observer's detail is
 * built as `<provider> · <result>` (or `<provider> <class>` on an idle round),
 * and the reference gives the model its own bold line with the run stats
 * beneath. Every other stage keeps its detail whole.
 */
export function flowNodeOf(event: AgentFlowEvent, latencyMs: number | null): FlowNode {
  const kind = nodeKindForStage(event.stage);
  const isError = event.outcome === 'error';
  const elapsed = latencyMs !== null ? `${formatDuration(latencyMs)} after queue` : '';

  if (kind === 'model') {
    const detail = event.detail ?? '';
    const separator = detail.indexOf(' ');
    const provider = separator === -1 ? detail : detail.slice(0, separator);
    const result = separator === -1 ? '' : detail.slice(separator + 1).replace(/^·\s*/, '');
    return {
      kind,
      title: provider || stageLabel(event.stage),
      subtitle: [result, elapsed].filter(Boolean).join(' · '),
      isError,
    };
  }

  if (kind === 'output') {
    // Stage label on top, produced text below — the reference puts the quiet
    // identifier above the thing you actually came to read.
    return {
      kind,
      title: stageLabel(event.stage),
      subtitle: event.detail ?? '',
      isError,
    };
  }

  return {
    kind,
    title: event.detail ?? stageLabel(event.stage),
    subtitle: [event.outcome ?? '', elapsed].filter(Boolean).join(' · '),
    isError,
  };
}

/**
 * Substring match across everything visible on a node.
 *
 * Case-insensitive, and an all-whitespace query matches everything — a filter
 * box that hides the whole chart the moment someone taps space reads as a
 * crash.
 */
export function matchesFilter(event: AgentFlowEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [stageLabel(event.stage), event.detail ?? '', event.project ?? '', event.outcome ?? '']
    .some(field => field.toLowerCase().includes(needle));
}

/** Enough of a session id to tell two apart in a breadcrumb, not the whole UUID. */
export function shortSessionId(id: string | null): string {
  if (!id) return 'no session';
  return id.length <= 8 ? id : id.slice(0, 8);
}

/**
 * Oldest first, which is the reading order of the chart — the reference flows
 * downward through time. State holds newest-first, so this is where the two
 * conventions meet; do not flip the state order to save the reverse.
 */
export function toChartOrder(events: AgentFlowEvent[]): AgentFlowEvent[] {
  return [...events].reverse();
}
