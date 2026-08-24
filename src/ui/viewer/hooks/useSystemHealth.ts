import { useState, useEffect, useCallback, useRef } from 'react';
import { ChromaStatus, McpStatus, Probe, SyncStatus, UNREAD, WorkerHealth } from '../utils/systemHealth';

const REFRESH_INTERVAL_MS = 10000;
/** A hung probe must not hold the whole screen; the row says "unread" instead. */
const PROBE_TIMEOUT_MS = 8000;

export interface SystemHealth {
  health: Probe<WorkerHealth>;
  chroma: Probe<ChromaStatus>;
  mcp: Probe<McpStatus>;
  sync: Probe<SyncStatus>;
  /** When the last round of probes finished, or null before the first one. */
  checkedAt: number | null;
}

const EMPTY: SystemHealth = { health: UNREAD, chroma: UNREAD, mcp: UNREAD, sync: UNREAD, checkedAt: null };

/**
 * Reads a body whatever the status code says. /api/health answers 503 when the
 * queue is degraded, and that response carries the explanation — throwing it
 * away on `!res.ok` would blank the screen exactly when it has something to
 * report. Only a transport failure or unparseable body counts as unread.
 */
async function probe<T>(url: string): Promise<Probe<T>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { data: await response.json() as T, read: true };
  } catch {
    return UNREAD;
  }
}

export function useSystemHealth(): SystemHealth & { refresh: () => void; isRefreshing: boolean } {
  const [state, setState] = useState<SystemHealth>(EMPTY);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    const [health, chroma, mcp, sync] = await Promise.all([
      probe<WorkerHealth>('/api/health'),
      probe<ChromaStatus>('/api/chroma/status'),
      probe<McpStatus>('/api/mcp/status'),
      probe<SyncStatus>('/api/sync/status'),
    ]);
    if (!mounted.current) return;
    setState({ health, chroma, mcp, sync, checkedAt: Date.now() });
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);

  return { ...state, refresh: () => void load(), isRefreshing };
}
