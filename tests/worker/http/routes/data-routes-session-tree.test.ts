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

describe('GET /api/sessions/tree', () => {
  let store: SessionStore;
  let routes: DataRoutes;
  const project = 'tree-project';
  const baseEpoch = Date.UTC(2024, 5, 1, 12, 0, 0);

  function seedObservation(memorySessionId: string, title: string | null, epoch: number, obsProject = project) {
    return store.storeObservation(
      memorySessionId,
      obsProject,
      {
        type: 'discovery',
        title,
        subtitle: null,
        facts: [],
        narrative: 'narrative',
        concepts: [],
        files_read: [],
        files_modified: [],
      },
      1,
      0,
      epoch
    );
  }

  function seedSession(contentId: string, memoryId: string, prompt: string, sessionProject = project) {
    const dbId = store.createSDKSession(contentId, sessionProject, prompt, undefined, 'claude');
    store.ensureMemorySessionIdRegistered(dbId, memoryId);
    return dbId;
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

  it('returns one node per session, newest activity first, with SQL-counted totals', () => {
    seedSession('content-old', 'memory-old', '/doctor');
    seedObservation('memory-old', 'Older session first observation', baseEpoch);
    seedObservation('memory-old', 'Older session second observation', baseEpoch + 1_000);

    seedSession('content-new', 'memory-new', '/doctor');
    seedObservation('memory-new', 'Newer session first observation', baseEpoch + 10_000);

    const handler = captureRoute(routes, '/api/sessions/tree');
    const { res, json } = makeResponse();
    handler(makeRequest({ project }), res);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.sessions.map((s: any) => s.sessionId)).toEqual(['memory-new', 'memory-old']);
    expect(payload.sessions[1]).toMatchObject({
      sessionId: 'memory-old',
      project,
      count: 2,
      firstAt: baseEpoch,
      lastAt: baseEpoch + 1_000,
    });
  });

  it('labels a session with its oldest observation title, not its colliding user prompt', () => {
    seedSession('content-a', 'memory-a', '/doctor');
    seedObservation('memory-a', 'Touch Bar DFR APIs confirmed', baseEpoch + 5_000);
    seedObservation('memory-a', 'A later observation', baseEpoch + 6_000);

    const handler = captureRoute(routes, '/api/sessions/tree');
    const { res, json } = makeResponse();
    handler(makeRequest({ project }), res);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.sessions[0].label).toBe('Touch Bar DFR APIs confirmed');
  });

  it('falls back to a short id when nothing titles the session', () => {
    seedSession('content-b', 'abcdef01-2345-6789-abcd-ef0123456789', 'prompt');
    seedObservation('abcdef01-2345-6789-abcd-ef0123456789', null, baseEpoch);

    const handler = captureRoute(routes, '/api/sessions/tree');
    const { res, json } = makeResponse();
    handler(makeRequest({ project }), res);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.sessions[0].label).toBe('Session abcdef');
  });

  it('scopes to the requested project', () => {
    seedSession('content-mine', 'memory-mine', 'prompt');
    seedObservation('memory-mine', 'Mine', baseEpoch);
    seedSession('content-other', 'memory-other', 'prompt', 'other-project');
    seedObservation('memory-other', 'Theirs', baseEpoch + 1_000, 'other-project');

    const handler = captureRoute(routes, '/api/sessions/tree');
    const { res, json } = makeResponse();
    handler(makeRequest({ project }), res);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.sessions.map((s: any) => s.sessionId)).toEqual(['memory-mine']);
  });

  it('omits the observer-sessions project when no project is requested', () => {
    seedSession('content-visible', 'memory-visible', 'prompt');
    seedObservation('memory-visible', 'Visible', baseEpoch);
    seedSession('content-hidden', 'memory-hidden', 'prompt', OBSERVER_SESSIONS_PROJECT);
    seedObservation('memory-hidden', 'Hidden', baseEpoch + 1_000, OBSERVER_SESSIONS_PROJECT);

    const handler = captureRoute(routes, '/api/sessions/tree');
    const { res, json } = makeResponse();
    handler(makeRequest({}), res);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.sessions.map((s: any) => s.sessionId)).toEqual(['memory-visible']);
  });
});

describe('PaginationHelper.getObservations session filter', () => {
  let store: SessionStore;
  let helper: PaginationHelper;
  const project = 'session-filter-project';
  const baseEpoch = Date.UTC(2024, 5, 2, 12, 0, 0);

  beforeEach(() => {
    store = new SessionStore(':memory:');
    helper = new PaginationHelper({ getSessionStore: () => store } as any);
  });

  afterEach(() => {
    store.close();
  });

  function seed(memorySessionId: string, title: string, epoch: number) {
    const dbId = store.createSDKSession(`content-${memorySessionId}`, project, 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(dbId, memorySessionId);
    store.storeObservation(
      memorySessionId,
      project,
      { type: 'discovery', title, subtitle: null, facts: [], narrative: 'n', concepts: [], files_read: [], files_modified: [] },
      1,
      0,
      epoch
    );
  }

  it('returns only the requested session', () => {
    seed('memory-one', 'ONE', baseEpoch);
    seed('memory-two', 'TWO', baseEpoch + 1_000);

    const result = helper.getObservations(0, 50, project, undefined, 'memory-one');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('ONE');
    expect(result.hasMore).toBe(false);
  });

  it('returns every session when no session is given', () => {
    seed('memory-one', 'ONE', baseEpoch);
    seed('memory-two', 'TWO', baseEpoch + 1_000);

    const result = helper.getObservations(0, 50, project);

    expect(result.items).toHaveLength(2);
  });
});
