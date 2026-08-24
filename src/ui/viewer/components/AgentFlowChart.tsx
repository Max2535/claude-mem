import React, { useEffect, useLayoutEffect, useRef } from 'react';
import type { AgentFlowEvent } from '../types';
import {
  flowNodeOf,
  formatFlowTime,
  queueLatencyMs,
  stageLabel,
} from '../utils/agentFlow';

interface AgentFlowChartProps {
  /** Oldest first — the chart reads downward through time. */
  nodes: AgentFlowEvent[];
  /** Newest-first, as held in state. Only used to resolve queue latency. */
  latencySource: AgentFlowEvent[];
  /** Suspends auto-scroll while the reader has the stream frozen. */
  paused: boolean;
  emptyMessage: string;
}

/**
 * How close to the bottom still counts as "following the stream".
 *
 * Auto-scroll has to stop the moment someone scrolls up to read, or the page
 * yanks itself away mid-sentence every few seconds. A few pixels of slack
 * absorbs fractional scroll heights so following does not switch off on its own.
 */
const FOLLOW_SLACK_PX = 48;

/**
 * The connector between two nodes.
 *
 * An elbow rather than a straight line, copied from the reference: the jog
 * makes the direction of flow readable at a glance even where two nodes are
 * the same width. Fixed geometry in a fixed-size SVG, so no measuring pass and
 * no layout dependency between siblings.
 */
function Connector() {
  return (
    <svg className="flow-connector" width="120" height="30" viewBox="0 0 120 30" aria-hidden="true">
      <path className="flow-connector-line" d="M20 0 L20 14 Q20 18 24 18 L56 18 Q60 18 60 22 L60 25" />
      <path className="flow-connector-head" d="M56 22 L60 30 L64 22" />
    </svg>
  );
}

export function AgentFlowChart({ nodes, latencySource, paused, emptyMessage }: AgentFlowChartProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Follow until the reader scrolls away; a ref because the scroll handler must
  // not re-render the chart on every wheel tick.
  const followingRef = useRef(true);

  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const onScroll = () => {
      const distanceFromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      followingRef.current = distanceFromBottom <= FOLLOW_SLACK_PX;
    };
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => pane.removeEventListener('scroll', onScroll);
  }, []);

  // Layout effect, not effect: scrolling after paint makes the new node visibly
  // appear at the bottom edge and then jump.
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (!pane || paused || !followingRef.current) return;
    pane.scrollTop = pane.scrollHeight;
  }, [nodes, paused]);

  if (nodes.length === 0) {
    return <div className="chart-empty">{emptyMessage}</div>;
  }

  return (
    <div className="flow-chart" ref={scrollRef}>
      <div className="flow-chart-column">
        {nodes.map((event, index) => {
          const node = flowNodeOf(event, queueLatencyMs(latencySource, event));
          return (
            <React.Fragment key={event.seq}>
              {index > 0 && <Connector />}
              <div
                className={`flow-node is-${node.kind}${node.isError ? ' is-error' : ''}`}
                title={`${stageLabel(event.stage)} · ${event.project ?? 'unknown project'}`}
              >
                <div className="flow-node-head">
                  {node.kind === 'tool' && (
                    <span className="flow-node-glyph" aria-hidden="true">⚒</span>
                  )}
                  <span className="flow-node-title">{node.title}</span>
                  <span className="flow-node-time">{formatFlowTime(event.at)}</span>
                </div>
                {node.subtitle && <div className="flow-node-subtitle">{node.subtitle}</div>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
