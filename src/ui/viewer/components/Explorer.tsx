import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ObservationCard } from './ObservationCard';
import { TreeGraph } from './TreeGraph';
import { useExplorerDay } from '../hooks/useExplorerDay';
import { splitIntoBlocks, GroupMode } from '../utils/explorerHierarchy';
import { Observation } from '../types';

const TABS = [
  { id: 'tree', label: 'Tree', built: true },
  { id: 'digest', label: 'Digest', built: false },
  { id: 'activity', label: 'Activity', built: false },
] as const;

type TabId = typeof TABS[number]['id'];

interface ExplorerProps {
  currentFilter: string;
  liveObservationCount: number;
  /** Observation id from the URL tail, or undefined for no selection. */
  selectedId?: string;
  onSelect: (observationId?: string) => void;
}

function formatDay(day: string): string {
  // Parse as local midnight rather than letting Date treat it as UTC, which
  // would shift the label a day backwards west of Greenwich.
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function clockLabel(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function Explorer({ currentFilter, liveObservationCount, selectedId, onSelect }: ExplorerProps) {
  const [tab, setTab] = useState<TabId>('tree');
  const [mode, setMode] = useState<GroupMode>('time');
  const [day, setDay] = useState<string | null>(null);
  const [blockIndex, setBlockIndex] = useState(0);
  // A nonce rather than just the id: clicking Locate twice on the same block
  // must re-centre, and an unchanged id would not re-run the effect.
  const [locate, setLocate] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [selected, setSelected] = useState<Observation | null>(null);

  const { data, isLoading, error } = useExplorerDay(currentFilter, day, liveObservationCount);

  // The server decides which day to show when none is pinned; adopt it so the
  // stepper has somewhere to step from.
  useEffect(() => {
    if (!day && data.day) setDay(data.day);
  }, [data.day, day]);

  const blocks = useMemo(() => splitIntoBlocks(data.observations), [data.observations]);

  useEffect(() => { setBlockIndex(0); }, [data.day, mode]);

  const dayIndex = data.day ? data.days.indexOf(data.day) : -1;
  const stepDay = useCallback((delta: number) => {
    const next = data.days[dayIndex + delta];
    if (next) setDay(next);
  }, [data.days, dayIndex]);

  const block = blocks[blockIndex];
  const blockLabel = block
    ? `${clockLabel(block[0].createdAt)} – ${clockLabel(block[block.length - 1].createdAt)}`
    : '—';

  const handleLocate = useCallback(() => {
    if (!data.day || mode !== 'time') return;
    setLocate(prev => ({ nodeId: `day-${data.day}-b${blockIndex}`, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [data.day, blockIndex, mode]);

  // Fetch the full row for whatever the URL points at — the graph only carries
  // labels, and a deep link may name an observation on another day entirely.
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/observation/${selectedId}`);
        if (!response.ok) return;
        const observation = await response.json() as Observation;
        if (cancelled) return;
        setSelected(observation);
        const observationDay = new Date(observation.created_at_epoch);
        const key = [
          observationDay.getFullYear(),
          String(observationDay.getMonth() + 1).padStart(2, '0'),
          String(observationDay.getDate()).padStart(2, '0'),
        ].join('-');
        setDay(prev => (prev === key ? prev : key));
      } catch {
        // A bad id in the URL just leaves the panel closed.
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId]);

  const currentTab = TABS.find(t => t.id === tab)!;

  return (
    <div className="page explorer">
      <header className="page-head">
        <h1 className="page-title">Explorer</h1>
        <p className="page-subtitle">Multi-dimensional view of your memory</p>
      </header>

      <div className="explorer-tabs" role="tablist" aria-label="Explorer views">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`explorer-tab${tab === t.id ? ' is-active' : ''}${t.built ? '' : ' is-soon'}`}
            onClick={() => t.built && setTab(t.id)}
            disabled={!t.built}
            title={t.built ? undefined : 'Not built yet'}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="explorer-toolbar">
        <div className="explorer-stepper">
          <button type="button" onClick={() => stepDay(-1)} disabled={dayIndex <= 0} aria-label="Previous day">‹</button>
          <span className="explorer-stepper-value">{data.day ? formatDay(data.day) : '—'}</span>
          <button type="button" onClick={() => stepDay(1)} disabled={dayIndex < 0 || dayIndex >= data.days.length - 1} aria-label="Next day">›</button>
        </div>

        <div className="explorer-stepper">
          <button type="button" onClick={() => setBlockIndex(i => Math.max(0, i - 1))} disabled={blockIndex <= 0 || mode !== 'time'} aria-label="Previous time block">‹</button>
          <span className="explorer-stepper-value">{mode === 'time' ? blockLabel : 'all day'}</span>
          <button type="button" onClick={() => setBlockIndex(i => Math.min(blocks.length - 1, i + 1))} disabled={mode !== 'time' || blockIndex >= blocks.length - 1} aria-label="Next time block">›</button>
          <button type="button" className="explorer-locate" onClick={handleLocate} disabled={mode !== 'time' || !block}>Locate</button>
        </div>

        <div className="explorer-modes" role="group" aria-label="Group by">
          <button type="button" className={`explorer-mode${mode === 'time' ? ' is-active' : ''}`} aria-pressed={mode === 'time'} onClick={() => setMode('time')}>By Time</button>
          <button type="button" className={`explorer-mode${mode === 'app' ? ' is-active' : ''}`} aria-pressed={mode === 'app'} onClick={() => setMode('app')}>By Project</button>
        </div>
      </div>

      {!currentTab.built ? (
        <div className="tree-graph-empty">{currentTab.label} is not built yet.</div>
      ) : isLoading && data.observations.length === 0 ? (
        <div className="tree-graph-empty">Loading…</div>
      ) : error && data.observations.length === 0 ? (
        <div className="tree-graph-empty">Could not load: {error}</div>
      ) : data.day ? (
        <TreeGraph
          day={data.day}
          observations={data.observations}
          mode={mode}
          selectedId={selected?.id}
          onSelect={id => onSelect(String(id))}
          locate={locate}
        />
      ) : (
        <div className="tree-graph-empty">No observations recorded yet.</div>
      )}

      {selected && (
        <aside className="explorer-detail-panel" aria-label="Selected observation">
          <button type="button" className="explorer-detail-close" onClick={() => onSelect(undefined)} aria-label="Close">×</button>
          <ObservationCard observation={selected} />
        </aside>
      )}
    </div>
  );
}
