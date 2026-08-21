import { useState, useEffect, useCallback, useRef } from 'react';
import { API_ENDPOINTS } from '../constants/api';
import { Observation, ExplorerSession } from '../types';

/** Server caps `limit` at 100, so asking for more silently gets 100 anyway. */
const PAGE_SIZE = 100;

/** SSE can fire several times per second while a session is being compressed. */
const REFETCH_DEBOUNCE_MS = 1000;

export interface SessionPage {
  items: Observation[];
  hasMore: boolean;
  offset: number;
  isLoading: boolean;
}

export function useExplorerTree(project: string, liveObservationCount: number) {
  const [sessions, setSessions] = useState<ExplorerSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, SessionPage>>({});

  const projectRef = useRef(project);
  projectRef.current = project;

  const fetchTree = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectRef.current) params.set('project', projectRef.current);

    try {
      const response = await fetch(`/api/sessions/tree?${params}`);
      if (!response.ok) throw new Error(response.statusText);
      const data = await response.json() as { sessions: ExplorerSession[] };
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      // Keep the last good tree on screen rather than blanking it — a failed
      // background refetch should not destroy what the user is reading.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    // Pages are keyed by session id, but they were fetched under the previous
    // project filter — drop them so a filter change cannot show foreign rows.
    setPages({});
    void fetchTree();
  }, [project, fetchTree]);

  // Counts come from SQL, so the only correct response to a live observation is
  // to ask again. Merging the event into the tree cannot work: nodes carry a
  // count, not the ids needed to tell a new observation from a counted one.
  useEffect(() => {
    if (liveObservationCount === 0) return;
    const timer = setTimeout(() => void fetchTree(), REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [liveObservationCount, fetchTree]);

  const loadSession = useCallback(async (sessionId: string) => {
    const existing = pages[sessionId];
    if (existing?.isLoading || (existing && !existing.hasMore)) return;

    const offset = existing?.offset ?? 0;
    setPages(prev => ({
      ...prev,
      [sessionId]: {
        items: existing?.items ?? [],
        hasMore: existing?.hasMore ?? true,
        offset,
        isLoading: true,
      },
    }));

    const params = new URLSearchParams({
      session: sessionId,
      offset: offset.toString(),
      limit: PAGE_SIZE.toString(),
    });
    if (projectRef.current) params.set('project', projectRef.current);

    try {
      const response = await fetch(`${API_ENDPOINTS.OBSERVATIONS}?${params}`);
      if (!response.ok) throw new Error(response.statusText);
      const data = await response.json() as { items: Observation[]; hasMore: boolean };

      setPages(prev => ({
        ...prev,
        [sessionId]: {
          items: [...(prev[sessionId]?.items ?? []), ...data.items],
          hasMore: data.hasMore,
          offset: offset + data.items.length,
          isLoading: false,
        },
      }));
    } catch {
      setPages(prev => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], isLoading: false },
      }));
    }
  }, [pages]);

  return { sessions, pages, isLoading, error, loadSession, refetch: fetchTree };
}
