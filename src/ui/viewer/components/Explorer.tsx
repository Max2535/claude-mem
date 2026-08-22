import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  const [locate, setLocate] = useState<{ nodeId: string; nonce: number; pulse: boolean } | null>(null);
  const [selected, setSelected] = useState<Observation | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  // A deep link can land on another day, which re-centres the whole graph;
  // yanking the page down to the panel on top of that hides what just loaded.
  const suppressDetailScrollRef = useRef(false);

  const { data, isLoading, error } = useExplorerDay(currentFilter, day, liveObservationCount);

  // The deep-link effect only depends on selectedId, so it reads the current
  // day through a ref rather than a stale closure.
  const dayRef = useRef<string | null>(null);
  dayRef.current = day;

  // A deep link picks the day too, and the two choices race: both land as
  // effects in the same commit and whichever runs second wins, which is how a
  // link to yesterday ends up drawing today's tree. Hold the adoption until
  // the link has had its say.
  const [deepLinkPending, setDeepLinkPending] = useState<boolean>(!!selectedId);

  // The server decides which day to show when none is pinned; adopt it so the
  // stepper has somewhere to step from.
  useEffect(() => {
    if (!day && data.day && !deepLinkPending) setDay(data.day);
  }, [data.day, day, deepLinkPending]);

  const blocks = useMemo(() => splitIntoBlocks(data.observations), [data.observations]);

  useEffect(() => { setBlockIndex(0); }, [data.day, mode]);

  const dayIndex = data.day ? data.days.indexOf(data.day) : -1;
  const stepDay = useCallback((delta: number) => {
    const next = data.days[dayIndex + delta];
    if (next) setDay(next);
  }, [data.days, dayIndex]);

  const block = blocks[blockIndex];
  /** The stepper is a cursor over the day, so moving it moves the canvas too. */
  const stepBlock = useCallback((delta: number) => {
    setBlockIndex(prev => {
      const next = Math.min(Math.max(prev + delta, 0), blocks.length - 1);
      // Set from the handler rather than an effect on blockIndex: an effect
      // would also fire on mount and fight the deep-link scroll.
      setLocate(current => ({ nodeId: `day-${data.day}-b${next}`, nonce: (current?.nonce ?? 0) + 1, pulse: false }));
      return next;
    });
  }, [blocks.length, data.day]);
  const blockLabel = block
    ? `${clockLabel(block[0].createdAt)} – ${clockLabel(block[block.length - 1].createdAt)}`
    : '—';

  const handleLocate = useCallback(() => {
    if (!data.day || mode !== 'time') return;
    setLocate(prev => ({ nodeId: `day-${data.day}-b${blockIndex}`, nonce: (prev?.nonce ?? 0) + 1, pulse: true }));
  }, [data.day, blockIndex, mode]);

  // Fetch the full row for whatever the URL points at — the graph only carries
  // labels, and a deep link may name an observation on another day entirely.
  useEffect(() => {
    if (!selectedId) { setSelected(null); setDeepLinkPending(false); return; }
    setDeepLinkPending(true);
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/observation/${selectedId}`);
        if (!response.ok) return;
        const observation = await response.json() as Observation;
        if (cancelled) return;
        const observationDay = new Date(observation.created_at_epoch);
        const key = [
          observationDay.getFullYear(),
          String(observationDay.getMonth() + 1).padStart(2, '0'),
          String(observationDay.getDate()).padStart(2, '0'),
        ].join('-');
        if (dayRef.current !== key) {
          suppressDetailScrollRef.current = true;
          setDay(key);
        }
        setSelected(observation);
      } catch {
        // A bad id in the URL just leaves the panel closed.
      } finally {
        if (!cancelled) setDeepLinkPending(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId]);

  // The panel sits below a canvas that keeps its natural height, so on most
  // viewports a click leaves it off-screen unless we go to it.
  useEffect(() => {
    if (!selected) return;
    if (suppressDetailScrollRef.current) {
      suppressDetailScrollRef.current = false;
      return;
    }
    detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected?.id]);

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

        {/* With one block the day is the block, and by project every control
            here is permanently disabled — a dead control is worse than none. */}
        {mode === 'time' && blocks.length > 1 && (
          <div className="explorer-stepper">
            <button type="button" onClick={() => stepBlock(-1)} disabled={blockIndex <= 0} aria-label="Previous time block">‹</button>
            <span className="explorer-stepper-value">{blockLabel}</span>
            <button type="button" onClick={() => stepBlock(1)} disabled={blockIndex >= blocks.length - 1} aria-label="Next time block">›</button>
            <button type="button" className="explorer-locate" onClick={handleLocate} disabled={!block}>Locate</button>
          </div>
        )}

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
          currentBlockId={mode === 'time' && blocks.length > 1 ? `day-${data.day}-b${blockIndex}` : undefined}
          locate={locate}
        />
      ) : (
        <div className="tree-graph-empty">No observations recorded yet.</div>
      )}

      {selected && (
        <aside className="explorer-detail-panel" ref={detailRef} aria-label="Selected observation">
          <button type="button" className="explorer-detail-close" onClick={() => onSelect(undefined)} aria-label="Close">×</button>
          <ObservationCard observation={selected} />
        </aside>
      )}
    </div>
  );
}
