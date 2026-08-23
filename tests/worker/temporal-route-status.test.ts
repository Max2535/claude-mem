import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import express from 'express';
import http from 'http';
import { SearchRoutes } from '../../src/services/worker/http/routes/SearchRoutes.js';

/**
 * GET /api/search/temporal used to answer 200 while carrying an `error` field,
 * so response.ok could not be trusted and the Chat screen had to parse the body
 * to find out whether a walk had happened at all. This fork owns both sides of
 * that contract, so the status is what changed.
 */
describe('GET /api/search/temporal status', () => {
  let server: http.Server;
  let port: number;

  function startWith(temporalSearch: (args: any) => Promise<any>): Promise<void> {
    const app = express();
    const routes = new SearchRoutes({
      temporalSearch,
      getSessionStore: () => ({}),
      getOrchestrator: () => ({}),
      getFormatter: () => ({}),
    } as any);
    routes.setupRoutes(app);
    port = 41000 + Math.floor(Math.random() * 10000);
    return new Promise<void>(resolve => {
      server = app.listen(port, '127.0.0.1', resolve);
    });
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  it('answers 409 with the body unchanged when vectorless is disabled', async () => {
    await startWith(async () => ({
      error: 'Vectorless retrieval is disabled',
      hint: 'Set CLAUDE_MEM_VECTORLESS_ENABLED=true in ~/.claude-mem/settings.json and restart the worker',
    }));

    const response = await fetch(`http://127.0.0.1:${port}/api/search/temporal?query=explorer`);

    expect(response.status).toBe(409);
    expect(response.ok).toBe(false);
    const body = await response.json() as Record<string, string>;
    expect(body.error).toBe('Vectorless retrieval is disabled');
    expect(body.hint).toContain('CLAUDE_MEM_VECTORLESS_ENABLED=true');
  });

  it('still answers 200 for a walk that ran', async () => {
    await startWith(async () => ({
      observations: [],
      coverage: { indexed: {}, matched: {}, total: {}, truncated: {} },
      traversal: { rounds: 1, daysWalked: [], sessionsWalked: [], indexRows: 0 },
      strategy: 'vectorless',
    }));

    const response = await fetch(`http://127.0.0.1:${port}/api/search/temporal?query=explorer`);

    expect(response.status).toBe(200);
    expect((await response.json() as Record<string, unknown>).strategy).toBe('vectorless');
  });

  /**
   * A walk that RAN and failed falls back to SQLite results under 200 with no
   * error (SearchOrchestrator.ts:66). That case is not a 409 — the client tells
   * it apart by the strategy the server names.
   */
  it('leaves a failed-walk fallback on 200 so the strategy check still decides it', async () => {
    await startWith(async () => ({ observations: [], strategy: 'sqlite' }));

    const response = await fetch(`http://127.0.0.1:${port}/api/search/temporal?query=explorer`);

    expect(response.status).toBe(200);
  });
});
