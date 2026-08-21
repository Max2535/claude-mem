import { useState, useEffect, useCallback } from 'react';
import { NAV_ITEMS, DEFAULT_ROUTE, RouteId } from '../constants/nav';

const VALID = new Set<string>(NAV_ITEMS.map(item => item.id));

function readHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return VALID.has(raw) ? (raw as RouteId) : DEFAULT_ROUTE;
}

/**
 * Hash routing rather than history.pushState: the viewer is served from a single
 * static route, so a real path would 404 on refresh, and hash changes need no
 * server cooperation and no router dependency in the bundle.
 */
export function useRoute(): [RouteId, (next: RouteId) => void] {
  const [route, setRoute] = useState<RouteId>(readHash);

  useEffect(() => {
    const onHashChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: RouteId) => {
    // Let hashchange drive state so a typed URL and a click follow one path.
    window.location.hash = `#/${next}`;
  }, []);

  return [route, navigate];
}
