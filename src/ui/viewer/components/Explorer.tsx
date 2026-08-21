import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ObservationCard } from './ObservationCard';
import { useExplorerTree, nodeKey } from '../hooks/useExplorerTree';
import { Observation, ExplorerSession } from '../types';

type GroupMode = 'time' | 'project';

interface ExplorerProps {
  currentFilter: string;
  liveObservationCount: number;
  /** Observation id from the URL tail, or undefined for the empty pane. */
  selectedId?: string;
  onSelect: (observationId?: string) => void;
}

function dayKey(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function timeLabel(epoch: number): string {
  return new Date(epoch).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Sessions arrive newest-first, so insertion order is already the display order. */
function groupSessions(sessions: ExplorerSession[], mode: GroupMode): [string, ExplorerSession[]][] {
  const groups = new Map<string, ExplorerSession[]>();

  for (const session of sessions) {
    const key = mode === 'time' ? dayKey(session.lastAt) : session.project;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(session);
    } else {
      groups.set(key, [session]);
    }
  }

  return [...groups.entries()];
}

export function Explorer({ currentFilter, liveObservationCount, selectedId, onSelect }: ExplorerProps) {
  const [mode, setMode] = useState<GroupMode>('time');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { sessions, pages, isLoading, error, loadSession } = useExplorerTree(currentFilter, liveObservationCount);

  // Expansion is keyed by session id and kept outside the data, so the debounced
  // SSE refetch replaces the tree without collapsing what the user opened.
  const toggle = useCallback((session: ExplorerSession) => {
    const key = nodeKey(session);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void loadSession(session);
      }
      return next;
    });
  }, [loadSession]);

  const groups = useMemo(() => groupSessions(sessions, mode), [sessions, mode]);

  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const selected: Observation | undefined = useMemo(() => {
    if (!selectedId) return undefined;
    const id = Number(selectedId);
    if (!Number.isFinite(id)) return undefined;
    for (const page of Object.values(pages)) {
      const hit = page.items.find(item => item.id === id);
      if (hit) return hit;
    }
    return undefined;
  }, [selectedId, pages]);

  // A deep link lands before any session is open, so nothing holds the target
  // observation yet. Ask the server which session owns it, then open that one.
  useEffect(() => {
    if (!selectedId || selected) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/observation/${selectedId}`);
        if (!response.ok) return;
        const observation = await response.json() as Observation;
        if (cancelled) return;
        // The tree row is the only place the node's stable key is known, so a
        // deep link has to be resolved through it rather than opened directly.
        const owner = sessions.find(s => s.sessionId === observation.memory_session_id);
        if (!owner) return;
        setExpanded(prev => new Set(prev).add(nodeKey(owner)));
        void loadSession(owner);
      } catch {
        // A bad id in the URL just leaves the pane empty.
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId, selected, loadSession, sessions]);

  // A deep link expands a session that may be hundreds of rows down; without
  // this the highlighted row sits off-screen and the tree looks unresponsive.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id, mode]);

  return (
    <div className="page explorer">
      <header className="page-head">
        <h1 className="page-title">Explorer</h1>
        <p className="page-subtitle">
          {currentFilter ? `Project: ${currentFilter}` : 'Across all projects'}
          {sessions.length > 0 && ` · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
        </p>
      </header>

      <div className="explorer-panes">
        <div className="explorer-tree" role="tree" aria-label="Sessions">
          <div className="explorer-modes" role="group" aria-label="Group sessions by">
            <button
              type="button"
              className={`explorer-mode${mode === 'time' ? ' is-active' : ''}`}
              aria-pressed={mode === 'time'}
              onClick={() => setMode('time')}
            >
              By time
            </button>
            <button
              type="button"
              className={`explorer-mode${mode === 'project' ? ' is-active' : ''}`}
              aria-pressed={mode === 'project'}
              onClick={() => setMode('project')}
            >
              By project
            </button>
          </div>

          {isLoading && sessions.length === 0 && (
            <p className="explorer-note">Loading sessions…</p>
          )}

          {!isLoading && sessions.length === 0 && (
            <p className="explorer-note">
              {error ? `Could not load sessions: ${error}` : 'No sessions recorded yet.'}
            </p>
          )}

          {groups.map(([groupLabel, groupSessionList]) => (
            <section className="explorer-group" key={groupLabel}>
              <h2 className="explorer-group-label">{groupLabel}</h2>

              {groupSessionList.map(session => {
                const isOpen = expanded.has(nodeKey(session));
                const page = pages[nodeKey(session)];
                const remaining = session.count - (page?.items.length ?? 0);

                return (
                  <div className="explorer-session" key={session.sessionId}>
                    <button
                      type="button"
                      className="explorer-session-btn"
                      aria-expanded={isOpen}
                      onClick={() => toggle(session)}
                    >
                      <svg
                        className={`explorer-caret${isOpen ? ' is-open' : ''}`}
                        width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <span className="explorer-session-text">
                        <span className="explorer-session-label">{session.label}</span>
                        <span className="explorer-session-meta">
                          {session.count} obs · {timeLabel(session.lastAt)}
                          {mode === 'time' && ` · ${session.project}`}
                        </span>
                      </span>
                    </button>

                    {isOpen && (
                      <div className="explorer-children" role="group">
                        {page?.items.map(observation => (
                          <button
                            type="button"
                            key={observation.id}
                            ref={selected?.id === observation.id ? selectedRef : undefined}
                            className={`explorer-obs${selected?.id === observation.id ? ' is-selected' : ''}`}
                            aria-current={selected?.id === observation.id}
                            onClick={() => onSelect(String(observation.id))}
                          >
                            {observation.title || observation.subtitle || `Observation #${observation.id}`}
                          </button>
                        ))}

                        {page?.isLoading && <p className="explorer-note">Loading…</p>}

                        {page && !page.isLoading && page.hasMore && (
                          <button
                            type="button"
                            className="explorer-more"
                            onClick={() => void loadSession(session)}
                          >
                            Show more{remaining > 0 ? ` — ${remaining} left` : ''}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className="explorer-detail">
          {selected ? (
            <ObservationCard observation={selected} />
          ) : (
            <p className="explorer-note explorer-detail-empty">
              {selectedId ? 'Loading observation…' : 'Select an observation to read it.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
