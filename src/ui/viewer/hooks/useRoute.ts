import { useState, useEffect, useCallback } from 'react';
import { NAV_ITEMS, DEFAULT_ROUTE, RouteId } from '../constants/nav';

const VALID = new Set<string>(NAV_ITEMS.map(item => item.id));

interface ParsedHash {
  route: RouteId;
  tail?: string;
}

/**
 * `#/explorer/81` -> { route: 'explorer', tail: '81' }. Only the first segment
 * is validated; the tail is opaque to the router and belongs to whichever
 * screen claims it. An unknown first segment still falls back to the default
 * route, tail and all, so a stale bookmark cannot strand the viewer.
 */
function readHash(): ParsedHash {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = raw.split('/');

  if (!VALID.has(head)) {
    return { route: DEFAULT_ROUTE };
  }

  const tail = rest.join('/');
  return { route: head as RouteId, tail: tail === '' ? undefined : tail };
}

function sameHash(a: ParsedHash, b: ParsedHash): boolean {
  return a.route === b.route && a.tail === b.tail;
}

/**
 * Hash routing rather than history.pushState: the viewer is served from a single
 * static route, so a real path would 404 on refresh, and hash changes need no
 * server cooperation and no router dependency in the bundle.
 */
export function useRoute(): [RouteId, string | undefined, (next: RouteId, tail?: string) => void] {
  const [parsed, setParsed] = useState<ParsedHash>(readHash);

  useEffect(() => {
    const onHashChange = () => {
      // Bail on an identical parse so a tail-only rewrite does not remount the
      // screen that just wrote it.
      setParsed(prev => (sameHash(prev, readHash()) ? prev : readHash()));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: RouteId, tail?: string) => {
    // Let hashchange drive state so a typed URL and a click follow one path.
    window.location.hash = tail ? `#/${next}/${tail}` : `#/${next}`;
  }, []);

  return [parsed.route, parsed.tail, navigate];
}
