import React, { useMemo, useState } from 'react';
import type { AgentFlowEvent } from '../types';
import { AgentFlowChart } from './AgentFlowChart';
import {
  FLOW_EVENT_LIMIT,
  filterFlowByProject,
  matchesFilter,
  shortSessionId,
  toChartOrder,
} from '../utils/agentFlow';

interface AgentFlowProps {
  flowEvents: AgentFlowEvent[];
  currentFilter: string;
  isProcessing: boolean;
  queueDepth: number;
}

/**
 * The live pipeline monitor, drawn as a flow chart.
 *
 * Deliberately not paginated and not backed by an endpoint: every node arrives
 * over the SSE connection the viewer already holds. That is also the feature's
 * main limit, and the footnote says so rather than letting an empty chart read
 * as "nothing happened".
 */
export function AgentFlow({ flowEvents, currentFilter, isProcessing, queueDepth }: AgentFlowProps) {
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  // Snapshot on pause: freezing the chart is the whole point of the button, so
  // it must not keep re-rendering underneath someone reading a node.
  const [frozen, setFrozen] = useState<AgentFlowEvent[]>([]);

  const live = paused ? frozen : flowEvents;

  // App.tsx seeds the project filter with '' and the sidebar can also set
  // 'all'; both mean unfiltered. Normalise once so the breadcrumb never prints
  // an empty segment and the filter never looks for a project named ''.
  const project = currentFilter && currentFilter !== 'all' ? currentFilter : null;

  const scoped = useMemo(() => filterFlowByProject(live, project), [live, project]);
  const matched = useMemo(
    () => scoped.filter(event => matchesFilter(event, query)),
    [scoped, query]
  );
  const chartNodes = useMemo(() => toChartOrder(matched), [matched]);

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      return;
    }
    setFrozen(flowEvents);
    setPaused(true);
  };

  const emptyMessage =
    flowEvents.length === 0
      ? 'Nothing yet. Nodes appear here as claude-mem works — run a tool in a Claude Code session.'
      : query.trim()
        ? `No nodes match “${query.trim()}”.`
        : 'No events for this project in the current stream.';

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Agent Flow</h1>
        <p className="page-subtitle">
          What claude-mem is doing right now — hooks arriving, batches queued, the observer answering.
        </p>
      </div>

      <div className="flow-crumbs">
        <span>Agent Flow</span>
        <span className="flow-crumb-sep" aria-hidden="true">›</span>
        <span>{project ?? 'all projects'}</span>
        <span className="flow-crumb-sep" aria-hidden="true">›</span>
        {/* The newest node's session, so the crumb tracks what is on screen
            rather than whatever happened to arrive first. */}
        <span>{shortSessionId(scoped[0]?.contentSessionId ?? null)}</span>
      </div>

      <div className="flow-status">
        <span className={`flow-pip ${isProcessing ? 'is-busy' : 'is-idle'}`} aria-hidden="true" />
        <span className="flow-status-text">
          {isProcessing ? 'Observer running' : 'Idle'}
          {queueDepth > 0 ? ` · ${queueDepth} queued` : ''}
        </span>
        <button
          type="button"
          className={`chart-range-btn ${paused ? 'is-active' : ''}`}
          onClick={togglePause}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="flow-filter">
        <input
          type="text"
          className="flow-filter-input"
          placeholder="Filter nodes…"
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label="Filter nodes"
        />
        <svg className="flow-filter-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 3h12l-4.6 5.2V13l-2.8 1.4V8.2z" />
        </svg>
      </div>

      <AgentFlowChart
        nodes={chartNodes}
        latencySource={live}
        paused={paused}
        emptyMessage={emptyMessage}
      />

      <p className="burn-note">
        Live only — nothing on this screen is stored. The worker replays its last 200 events to a viewer
        that connects mid-flight, and this list keeps the most recent {FLOW_EVENT_LIMIT}; everything older
        is gone. A hook that fails before reaching the worker never appears here at all — check the log
        console for those.
      </p>
    </div>
  );
}
