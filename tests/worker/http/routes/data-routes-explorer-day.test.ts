import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { Request, Response } from 'express';
import { SessionStore } from '../../../../src/services/sqlite/SessionStore.js';
import { DataRoutes } from '../../../../src/services/worker/http/routes/DataRoutes.js';
import { PaginationHelper } from '../../../../src/services/worker/PaginationHelper.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../../../src/shared/paths.js';

function captureRoute(routes: DataRoutes, targetPath: string): (req: Request, res: Response) => void {
  let handler: ((req: Request, res: Response) => void) | undefined;
  const register = mock((path: string, ...rest: any[]) => {
    if (path !== targetPath) return;
    handler = rest.length === 1 ? rest[0] : rest[1];
  });
  const app = { get: register, post: mock(() => {}), delete: mock(() => {}) };

  routes.setupRoutes(app as any);
  if (!handler) throw new Error(`Handler not registered for GET ${targetPath}`);
  return handler;
}

function makeResponse() {
  const json = mock(() => {});
  const res = { headersSent: false, json, status: mock(() => res) } as any;
  return { res: res as Response, json };
}

function makeRequest(query: Record<string, unknown> = {}): Request {
  return { path: '/test', body: {}, query, params: {}, get: () => undefined } as any;
}

describe('GET /api/explorer/day', () => {
  let store: SessionStore;
  let routes: DataRoutes;
  const project = 'tree-project';
  // Local noon, so the day the row lands on is the same one whatever the
  // machine's timezone offset is.
  const day1 = new Date(2024, 5, 1, 12, 0, 0).getTime();
  const day2 = new Date(2024, 5, 2, 12, 0, 0).getTime();

  function seedObservation(memorySessionId: string, title: string | null, epoch: number, obsProject = project, promptNumber = 1) {
    return store.storeObservation(
      memorySessionId,
      obsProject,
      { type: 'discovery', title, subtitle: null, facts: [], narrative: 'narrative', concepts: [], files_read: [], files_modified: [] },
      promptNumber,
      0,
      epoch
    );
  }

  function seedSession(contentId: string, memoryId: string, prompt: string, sessionProject = project) {
    const dbId = store.createSDKSession(contentId, sessionProject, prompt, undefined, 'claude');
    store.ensureMemorySessionIdRegistered(dbId, memoryId);
    return dbId;
  }

  function call(query: Record<string, unknown>) {
    const handler = captureRoute(routes, '/api/explorer/day');
    const { res, json } = makeResponse();
    handler(makeRequest(query), res);
    return json.mock.calls[0][0] as any;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    routes = new DataRoutes(
      new PaginationHelper({ getSessionStore: () => store } as any),
      { getSessionStore: () => store, getChromaSync: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
      Date.now(),
    );
  });

  afterEach(() => {
    store.close();
  });

  it('lists every day with observations and defaults to the newest', () => {
    seedSession('c1', 'm1', 'prompt');
    seedObservation('m1', 'Older', day1);
    seedObservation('m1', 'Newer', day2);

    const payload = call({ project });

    expect(payload.days).toHaveLength(2);
    expect(payload.day).toBe(payload.days[1]);
    expect(payload.observations).toHaveLength(1);
    expect(payload.observations[0].title).toBe('Newer');
  });

  it('returns the requested day when it exists', () => {
    seedSession('c1', 'm1', 'prompt');
    seedObservation('m1', 'Older', day1);
    seedObservation('m1', 'Newer', day2);

    const all = call({ project });
    const payload = call({ project, day: all.days[0] });

    expect(payload.day).toBe(all.days[0]);
    expect(payload.observations.map((o: any) => o.title)).toEqual(['Older']);
  });

  it('falls back to the newest day when the requested one has nothing', () => {
    seedSession('c1', 'm1', 'prompt');
    seedObservation('m1', 'Only', day1);

    const payload = call({ project, day: '1999-01-01' });

    expect(payload.day).toBe(payload.days[0]);
    expect(payload.observations).toHaveLength(1);
  });

  it('orders a day oldest first, so the client can find time blocks in one pass', () => {
    seedSession('c1', 'm1', 'prompt');
    seedObservation('m1', 'Second', day1 + 2000);
    seedObservation('m1', 'First', day1);
    seedObservation('m1', 'Third', day1 + 4000);

    expect(call({ project }).observations.map((o: any) => o.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('carries contentSessionId, which survives a memory_session_id rotation', () => {
    // The worker rotates memory_session_id when a content session continues: it
    // rewrites the existing observations onto a fresh id and drops the old one.
    // The graph groups its session tier by contentSessionId because of it, so
    // the payload has to carry that column.
    const dbId = seedSession('content-stable', 'memory-first', 'prompt');
    seedObservation('memory-first', 'Before the rotation', day1);

    const before = call({ project }).observations[0];
    expect(before).toMatchObject({ sessionId: 'memory-first', contentSessionId: 'content-stable' });

    store.db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?').run('memory-second', dbId);
    store.db.prepare('UPDATE observations SET memory_session_id = ? WHERE memory_session_id = ?')
      .run('memory-second', 'memory-first');

    const after = call({ project }).observations[0];
    expect(after.sessionId).toBe('memory-second');
    expect(after.contentSessionId).toBe(before.contentSessionId);
  });

  it('carries the prompt number, which is the tier between session and observation', () => {
    seedSession('c1', 'm1', 'prompt');
    seedObservation('m1', 'A', day1, project, 3);

    expect(call({ project }).observations[0].promptNumber).toBe(3);
  });

  it('scopes to the requested project', () => {
    seedSession('c-mine', 'm-mine', 'prompt');
    seedObservation('m-mine', 'Mine', day1);
    seedSession('c-other', 'm-other', 'prompt', 'other-project');
    seedObservation('m-other', 'Theirs', day1, 'other-project');

    expect(call({ project }).observations.map((o: any) => o.title)).toEqual(['Mine']);
  });

  it('omits the observer-sessions project when no project is requested', () => {
    seedSession('c-visible', 'm-visible', 'prompt');
    seedObservation('m-visible', 'Visible', day1);
    seedSession('c-hidden', 'm-hidden', 'prompt', OBSERVER_SESSIONS_PROJECT);
    seedObservation('m-hidden', 'Hidden', day1, OBSERVER_SESSIONS_PROJECT);

    expect(call({}).observations.map((o: any) => o.title)).toEqual(['Visible']);
  });

  it('reports an empty result rather than failing when nothing is recorded', () => {
    const payload = call({ project });
    expect(payload).toEqual({ day: null, days: [], observations: [] });
  });
});
