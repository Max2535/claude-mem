/**
 * The live-monitor event stream behind the viewer's Agent Flow screen.
 *
 * Deliberately NOT a table. Agent Flow answers "what is claude-mem doing right
 * now", and everything worth keeping past that moment is already durable
 * elsewhere — observations, summaries, and token usage all have their own rows.
 * A flow_events table would need retention, pruning, and sync rules to buy a
 * view that is stale the moment it is read, so the whole stream lives in this
 * ring and dies with the worker.
 *
 * The one concession to reality is the ring itself: a viewer opened mid-flight
 * would otherwise stare at an empty page until the next event happened, which
 * reads as "broken", not "idle". New SSE clients get the ring replayed.
 */

/** The pipeline stages a flow event can mark. */
export type AgentFlowStage =
  | 'hook_received'
  | 'session_started'
  | 'observation_queued'
  | 'compression_finished'
  | 'observation_written'
  | 'summary_written'
  | 'context_injected'
  | 'session_completed';

export interface AgentFlowEvent {
  /**
   * Monotonic within a worker lifetime. The viewer merges a replayed backlog
   * with live events, and wall-clock timestamps collide at millisecond
   * resolution — `seq` is the only safe ordering and dedupe key.
   */
  seq: number;
  stage: AgentFlowStage;
  /** Epoch ms. For display only; never order on this. */
  at: number;
  project: string | null;
  contentSessionId: string | null;
  sessionDbId: number | null;
  /**
   * One short operator-facing line: a tool name, a provider name, a count.
   *
   * NEVER user content. No prompt text, no tool input or output, no observation
   * body. This screen streams to any browser pointed at the worker port, and
   * the privacy test locks the rule rather than trusting each call site.
   */
  detail: string | null;
  /** null where the stage has no pass/fail meaning (e.g. hook_received). */
  outcome: 'ok' | 'idle' | 'error' | null;
}

export type AgentFlowEventInput = Omit<AgentFlowEvent, 'seq' | 'at'> & {
  /** Overridable only so tests can assert ordering without faking a clock. */
  at?: number;
};

import { logger } from '../../../utils/logger.js';

/** Roughly a few minutes of a busy session — enough to explain what just ran. */
export const AGENT_FLOW_BUFFER_SIZE = 200;

export class AgentFlowBuffer {
  private events: AgentFlowEvent[] = [];
  private nextSeq = 1;
  private warnedOnWrap = false;

  constructor(private readonly capacity: number = AGENT_FLOW_BUFFER_SIZE) {}

  record(input: AgentFlowEventInput): AgentFlowEvent {
    const event: AgentFlowEvent = {
      ...input,
      at: input.at ?? Date.now(),
      seq: this.nextSeq++,
    };
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
      if (!this.warnedOnWrap) {
        this.warnedOnWrap = true;
        // Once per worker lifetime: explains a gap at the top of a viewer's
        // replay without logging a line per event thereafter.
        logger.debug('WORKER', 'Agent Flow ring wrapped; older events are no longer replayable', {
          capacity: this.capacity,
        });
      }
    }
    return event;
  }

  /** Oldest first, so the viewer can append without re-sorting. */
  backlog(): AgentFlowEvent[] {
    return [...this.events];
  }

  size(): number {
    return this.events.length;
  }
}
