import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../constants/api';
import { TIMING } from '../constants/timing';
import { WorkerStats } from '../types';

/**
 * Polls /api/stats. The SSE stream carries new rows but not the database totals
 * behind them, so the tiles need their own source; the interval is slow because
 * these are counters, not a live feed.
 */
export function useStats(): { stats: WorkerStats | null; error: boolean } {
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(API_ENDPOINTS.STATS);
        if (!res.ok) throw new Error(`stats ${res.status}`);
        const data: WorkerStats = await res.json();
        if (!cancelled) {
          setStats(data);
          setError(false);
        }
      } catch {
        // Keep the last good numbers on screen; a blip should not blank the tiles.
        if (!cancelled) setError(true);
      }
    };

    load();
    const timer = setInterval(load, TIMING.STATS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { stats, error };
}
