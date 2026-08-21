import { useState, useEffect, useCallback, useRef } from 'react';
import { ExplorerDay } from '../types';

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

  const fetchDay = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectRef.current) params.set('project', projectRef.current);
    if (dayRef.current) params.set('day', dayRef.current);

    try {
      const response = await fetch(`/api/explorer/day?${params}`);
      if (!response.ok) throw new Error(response.statusText);
      setData(await response.json() as ExplorerDay);
      setError(null);
    } catch (err) {
      // Keep the last good day drawn; a failed background refetch should not
      // blank a graph someone is reading.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
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

  return { data, isLoading, error, refetch: fetchDay };
}
