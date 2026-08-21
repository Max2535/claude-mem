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
  /** Tree count at the time this page was fetched; a change means it is stale. */
  countAtFetch: number;
}

/**
 * The node's identity for expansion and caching. `sessionId` is the session's
 * memory_session_id, which the worker rotates when a content session continues
 * — it rewrites the existing observations onto a fresh id and drops the old
 * one. Keying off it made an open node collapse the moment a new observation
 * landed in it. contentSessionId survives that rotation.
 */
export function nodeKey(session: ExplorerSession): string {
  return session.contentSessionId || session.sessionId;
}

export function useExplorerTree(project: string, liveObservationCount: number) {
  const [sessions, setSessions] = useState<ExplorerSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, SessionPage>>({});

  const projectRef = useRef(project);
  projectRef.current = project;

  const fetchPage = useCallback(async (
    session: ExplorerSession,
    offset: number,
    previous: Observation[]
  ): Promise<void> => {
    const key = nodeKey(session);
    setPages(prev => ({
      ...prev,
      [key]: {
        items: previous,
        hasMore: prev[key]?.hasMore ?? true,
        offset,
        isLoading: true,
        countAtFetch: session.count,
      },
    }));

    const params = new URLSearchParams({
      session: session.sessionId,
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
        [key]: {
          items: [...previous, ...data.items],
          hasMore: data.hasMore,
          offset: offset + data.items.length,
          isLoading: false,
          countAtFetch: session.count,
        },
      }));
    } catch {
      setPages(prev => ({
        ...prev,
        [key]: { ...prev[key], isLoading: false },
      }));
    }
  }, []);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const fetchTree = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectRef.current) params.set('project', projectRef.current);

    try {
      const response = await fetch(`/api/sessions/tree?${params}`);
      if (!response.ok) throw new Error(response.statusText);
      const data = await response.json() as { sessions: ExplorerSession[] };
      setSessions(data.sessions);
      setError(null);

      // An open node whose count moved is showing a stale child list. Reload
      // its first page rather than leaving the header and the rows disagreeing.
      for (const session of data.sessions) {
        const cached = pagesRef.current[nodeKey(session)];
        if (cached && !cached.isLoading && cached.countAtFetch !== session.count) {
          void fetchPage(session, 0, []);
        }
      }
    } catch (err) {
      // Keep the last good tree on screen rather than blanking it — a failed
      // background refetch should not destroy what the user is reading.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    setIsLoading(true);
    // Pages are keyed by session, but they were fetched under the previous
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

  const loadSession = useCallback(async (session: ExplorerSession) => {
    const existing = pagesRef.current[nodeKey(session)];
    if (existing?.isLoading || (existing && !existing.hasMore)) return;
    await fetchPage(session, existing?.offset ?? 0, existing?.items ?? []);
  }, [fetchPage]);

  return { sessions, pages, isLoading, error, loadSession, refetch: fetchTree };
}
