import { useCallback, useRef, Dispatch, SetStateAction } from 'react';
import type { KeywordSearchResponse, MemoryWalkResponse } from '../types';
import { ChatTurn, readKeywordResponse, readWalkResponse } from '../utils/memoryWalk';

const RESULT_LIMIT = 12;

async function getJson<T>(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(url, { signal });
  let body: T | null = null;
  try {
    body = await response.json() as T;
  } catch {
    // A non-JSON body is not worth a thrown error — the caller already knows
    // the status, and a null body reads as "the walk said nothing usable".
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * One question in, one turn patched. The turn list lives in App so an answer
 * that cost a subprocess survives a trip to another route — which is also why
 * an in-flight request is NOT aborted on unmount: only the Stop button aborts.
 */
export function useMemoryChat(project: string, setTurns: Dispatch<SetStateAction<ChatTurn[]>>) {
  const controllerRef = useRef<AbortController | null>(null);
  const nextIdRef = useRef(1);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const id = nextIdRef.current++;
    const patch = (next: Partial<ChatTurn>) => {
      setTurns(prev => prev.map(turn => (turn.id === id ? { ...turn, ...next } : turn)));
    };

    setTurns(prev => [...prev, { id, question: trimmed, state: 'walking', observations: [] }]);

    const controller = new AbortController();
    controllerRef.current = controller;

    const params = new URLSearchParams({ query: trimmed, limit: String(RESULT_LIMIT) });
    if (project) params.set('project', project);

    try {
      const walk = await getJson<MemoryWalkResponse>(`/api/search/temporal?${params}`, controller.signal);
      const outcome = readWalkResponse(walk.ok, walk.status, walk.body);

      if (outcome.kind === 'walk') {
        patch({
          state: 'done',
          source: 'walk',
          observations: outcome.observations,
          traversal: outcome.traversal,
          coverage: outcome.coverage,
        });
        return;
      }

      const keyword = await getJson<KeywordSearchResponse>(`/api/search?${params}&format=json`, controller.signal);
      if (!keyword.ok) throw new Error(`Search failed with HTTP ${keyword.status}`);
      const { observations, omitted } = readKeywordResponse(keyword.body);
      patch({ state: 'done', source: 'keyword', observations, omitted, note: outcome.note });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        patch({ state: 'stopped' });
        return;
      }
      patch({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [project, setTurns]);

  return { ask, stop };
}
