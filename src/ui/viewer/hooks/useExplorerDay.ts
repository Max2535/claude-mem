import { useState, useEffect, useCallback, useRef } from 'react';
import { ExplorerDay } from '../types';
import { createLatestRequest } from '../utils/latestRequest';

const REFETCH_DEBOUNCE_MS = 1000;

const EMPTY: ExplorerDay = { day: null, days: [], observations: [] };

export function useExplorerDay(project: string, day: string | null, liveObservationCount: number) {
  const [data, setData] = useState<ExplorerDay>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectRef = useRef(project);
  projectRef.current = project;
  const dayRef = useRef(day);
  dayRef.current = day;

  // A day fetch can outlive the day it was for: switching projects or stepping
  // the date starts a new one, and the live-capture refetch fires every second.
  // Without this, a slow earlier response lands last and redraws the graph with
  // the wrong day's nodes.
  const request = useRef(createLatestRequest());

  const fetchDay = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectRef.current) params.set('project', projectRef.current);
    if (dayRef.current) params.set('day', dayRef.current);

    const ticket = request.current.start();

    try {
      const response = await fetch(`/api/explorer/day?${params}`, { signal: ticket.signal });
      if (!response.ok) throw new Error(response.statusText);
      const payload = await response.json() as ExplorerDay;
      if (!ticket.isCurrent()) return;
      setData(payload);
      setError(null);
    } catch (err) {
      // Superseded or unmounted — the caller asked for this, so it is not a
      // failure and there is no state left to update.
      if (!ticket.isCurrent()) return;
      // Keep the last good day drawn; a failed background refetch should not
      // blank a graph someone is reading.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (ticket.isCurrent()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void fetchDay();
  }, [project, day, fetchDay]);

  useEffect(() => {
    if (liveObservationCount === 0) return;
    const timer = setTimeout(() => void fetchDay(), REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [liveObservationCount, fetchDay]);

  useEffect(() => {
    const pending = request.current;
    return () => pending.cancel();
  }, []);

  return { data, isLoading, error, refetch: fetchDay };
}
