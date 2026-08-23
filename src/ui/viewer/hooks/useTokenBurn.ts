import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenBurnResponse } from '../types';
import { createLatestRequest } from '../utils/latestRequest';

/**
 * Burn is a counter, not a feed — it only ever grows, and a stale minute is
 * harmless. Polling slowly keeps the screen live without spending a query per
 * second on a number that moves once per turn.
 */
const REFRESH_INTERVAL_MS = 30_000;

export function useTokenBurn(project: string, days: number) {
  const [data, setData] = useState<TokenBurnResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectRef = useRef(project);
  projectRef.current = project;
  const daysRef = useRef(days);
  daysRef.current = days;

  // A window change can be answered out of order — switching 90d then 7d must
  // not land the slower 90d response last and redraw the wrong range.
  const request = useRef(createLatestRequest());

  const fetchBurn = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectRef.current) params.set('project', projectRef.current);
    params.set('days', String(daysRef.current));

    const ticket = request.current.start();
    try {
      const response = await fetch(`/api/token-burn?${params}`, { signal: ticket.signal });
      if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`);
      const payload = await response.json() as TokenBurnResponse;
      if (!ticket.isCurrent()) return;
      setData(payload);
      setError(null);
    } catch (err) {
      if (!ticket.isCurrent()) return;
      // Keep the last good numbers drawn: a blank chart on one failed poll is
      // a worse answer than a slightly old one.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (ticket.isCurrent()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void fetchBurn();
  }, [project, days, fetchBurn]);

  useEffect(() => {
    const timer = setInterval(() => void fetchBurn(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchBurn]);

  useEffect(() => {
    const pending = request.current;
    return () => pending.cancel();
  }, []);

  return { data, isLoading, error, refetch: fetchBurn };
}
