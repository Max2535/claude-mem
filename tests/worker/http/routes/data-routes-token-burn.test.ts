import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { Request, Response } from 'express';
import { SessionStore } from '../../../../src/services/sqlite/SessionStore.js';
import { DataRoutes } from '../../../../src/services/worker/http/routes/DataRoutes.js';
import { PaginationHelper } from '../../../../src/services/worker/PaginationHelper.js';
import type { TokenBurnResponse } from '../../../../src/services/worker-types.js';

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
  const json = mock((_body?: unknown) => {});
  const status = mock((_code?: number) => res);
  const res = { headersSent: false, json, status } as any;
  return { res: res as Response, json, status };
}

function makeRequest(query: Record<string, unknown> = {}): Request {
  return { path: '/test', body: {}, query, params: {}, get: () => undefined } as any;
}

describe('GET /api/token-burn', () => {
  let store: SessionStore;
  let routes: DataRoutes;
  let handler: (req: Request, res: Response) => void;

  // Local noon so the bucket a row lands in does not depend on the machine's
  // offset — the same trap the Explorer day tests document.
  const today = new Date();
  const noonToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime();
  const noonYesterday = noonToday - 24 * 60 * 60 * 1000;

  function seed(overrides: Record<string, any> = {}) {
    store.recordTokenUsage({
      eventKey: overrides.eventKey ?? `k-${Math.random()}`,
      source: overrides.source ?? 'plugin',
      component: overrides.component ?? 'observer',
      project: overrides.project ?? 'claude-mem',
      platformSource: overrides.platformSource ?? 'claude',
      inputTokens: overrides.inputTokens ?? 10,
      cacheCreationTokens: overrides.cacheCreationTokens ?? 100,
      cacheReadTokens: overrides.cacheReadTokens ?? 5000,
      outputTokens: overrides.outputTokens ?? 20,
      costUsd: overrides.costUsd ?? null,
      epoch: overrides.epoch ?? noonToday,
    });
  }

  function run(query: Record<string, unknown> = {}): TokenBurnResponse {
    const { res, json } = makeResponse();
    handler(makeRequest(query), res);
    return json.mock.calls[0][0] as TokenBurnResponse;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    routes = new DataRoutes(
      new PaginationHelper({ getSessionStore: () => store } as any),
      { getSessionStore: () => store, getChromaSync: () => null } as any,
      {} as any, {} as any, {} as any, Date.now(),
    );
    handler = captureRoute(routes, '/api/token-burn');
  });

  afterEach(() => {
    store.close();
  });

  it('keeps the two series apart rather than summing them', () => {
    seed({ source: 'plugin', outputTokens: 20 });
    seed({ source: 'user', outputTokens: 700 });

    const body = run();

    expect(body.totals.plugin.outputTokens).toBe(20);
    expect(body.totals.user.outputTokens).toBe(700);
  });

  // Cache reads bill at roughly a tenth and are ~190k per observer turn.
  // Folding them into the headline number would overstate plugin cost ~10x.
  it('excludes cache reads from the billable figure but still reports them', () => {
    seed({ inputTokens: 10, cacheCreationTokens: 100, cacheReadTokens: 5000, outputTokens: 20 });

    const plugin = run().totals.plugin;

    expect(plugin.billableTokens).toBe(130);
    expect(plugin.totalTokens).toBe(5130);
    expect(plugin.cacheReadTokens).toBe(5000);
  });

  it('returns a contiguous zero-filled window, not just the days with spend', () => {
    seed({ epoch: noonToday });

    const body = run({ days: 7 });

    expect(body.buckets.length).toBe(7);
    expect(body.days).toBe(7);
    const sorted = [...body.buckets].sort((a, b) => a.bucket.localeCompare(b.bucket));
    expect(body.buckets.map(b => b.bucket)).toEqual(sorted.map(b => b.bucket));
    const quiet = body.buckets[0];
    expect(quiet.plugin.billableTokens).toBe(0);
    expect(quiet.user.billableTokens).toBe(0);
  });

  it('places spend on the local day it happened', () => {
    seed({ epoch: noonYesterday, outputTokens: 42 });

    // The expected day is asked of SQLite, not computed in JS. Under `bun
    // test` the two disagree about the local zone, and a JS-derived
    // expectation would be testing the test's timezone rather than the code's
    // bucketing — the very divergence getTokenBurn is built to avoid.
    const expected = (store.db.prepare(
      "SELECT date(? / 1000, 'unixepoch', 'localtime') AS d"
    ).get(noonYesterday) as { d: string }).d;

    const body = run({ days: 7 });
    const withSpend = body.buckets.filter(b => b.plugin.outputTokens > 0);

    expect(withSpend.length).toBe(1);
    expect(withSpend[0].bucket).toBe(expected);
    expect(body.buckets.map(b => b.bucket)).toContain(expected);
  });

  it('leaves cost null when nothing in scope reported one', () => {
    seed({ costUsd: null });
    expect(run().totals.plugin.costUsd).toBeNull();
  });

  // null and 0 are different claims: "nobody priced this" vs "it was free".
  it('sums only reported costs and reports the sum', () => {
    seed({ costUsd: 0.25 });
    seed({ costUsd: null });
    expect(run().totals.plugin.costUsd).toBeCloseTo(0.25);
  });

  it('reports overhead as a ratio, and refuses to divide by an empty user series', () => {
    seed({ source: 'plugin', inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 50 });
    expect(run().totals.overheadRatio).toBeNull();

    seed({ source: 'user', inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 200 });
    expect(run().totals.overheadRatio).toBeCloseTo(0.25);
  });

  it('scopes to a project when asked', () => {
    seed({ project: 'claude-mem', outputTokens: 5 });
    seed({ project: 'other-thing', outputTokens: 500 });

    expect(run({ project: 'claude-mem' }).totals.plugin.outputTokens).toBe(5);
    expect(run().totals.plugin.outputTokens).toBe(505);
  });

  it('scopes to a platform when asked', () => {
    seed({ platformSource: 'claude', outputTokens: 5 });
    seed({ platformSource: 'codex', outputTokens: 500 });

    expect(run({ platformSource: 'codex' }).totals.plugin.outputTokens).toBe(500);
  });

  it('falls back to the default window on an unusable days value', () => {
    expect(run({ days: 'abc' }).days).toBe(30);
    expect(run({ days: '-4' }).days).toBe(30);
    expect(run({ days: '' }).days).toBe(30);
  });

  // The endpoint is unauthenticated and local; an unbounded window would let a
  // stray request group the entire table.
  it('clamps an absurd window rather than honouring it', () => {
    expect(run({ days: '99999' }).days).toBe(365);
  });

  it('rejects a bucket size it does not implement instead of silently using days', () => {
    const { res, status, json } = makeResponse();
    handler(makeRequest({ bucket: 'week' }), res);

    expect(status).toHaveBeenCalledWith(400);
    expect((json.mock.calls[0][0] as any).error).toContain('bucket');
  });

  it('says which platforms it can actually read, rather than implying zero spend', () => {
    expect(run().platformsCovered).toEqual(['claude']);
  });

  it('reports the first recorded day so the screen can say history starts at install', () => {
    expect(run().since).toBeNull();
    seed({ epoch: noonYesterday });
    expect(run().since).not.toBeNull();
  });
});
