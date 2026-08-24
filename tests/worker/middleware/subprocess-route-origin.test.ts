import { describe, it, expect, afterEach } from 'bun:test';
import express from 'express';
import http from 'http';
import { SearchRoutes } from '../../../src/services/worker/http/routes/SearchRoutes.js';

/**
 * GET /api/search/temporal is local, unauthenticated, and spawns a Claude Agent
 * SDK subprocess per request — and any page in any browser can reach localhost.
 * The concurrency cap and the 120s timeout bound what a flood costs; only this
 * gate stops one from starting.
 *
 * The three callers that must keep working: the viewer's own fetch (same-origin,
 * so no Origin header but a localhost Referer), the MCP server and CLI (no
 * Origin, no Referer at all), and a browser sending an explicit localhost Origin.
 */
describe('cross-origin gate on subprocess-spawning routes', () => {
  let server: http.Server;
  let port: number;
  let walks = 0;

  async function start(): Promise<void> {
    walks = 0;
    const app = express();
    const routes = new SearchRoutes({
      temporalSearch: async () => {
        walks++;
        return { observations: [], strategy: 'vectorless' };
      },
      getSessionStore: () => ({}),
      getOrchestrator: () => ({}),
      getFormatter: () => ({}),
    } as any);
    routes.setupRoutes(app);
    port = 41000 + Math.floor(Math.random() * 10000);
    await new Promise<void>(resolve => {
      server = app.listen(port, '127.0.0.1', resolve);
    });
  }

  function walk(headers: Record<string, string>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/search/temporal?query=explorer`, { headers });
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }
  });

  it('lets a caller with no Origin and no Referer through (MCP, CLI, curl)', async () => {
    await start();
    const response = await walk({});
    expect(response.status).toBe(200);
    expect(walks).toBe(1);
  });

  it('lets the viewer through on a localhost Referer alone', async () => {
    await start();
    const response = await walk({ Referer: `http://localhost:${port}/` });
    expect(response.status).toBe(200);
    expect(walks).toBe(1);
  });

  it('lets an explicit localhost or 127.0.0.1 Origin through', async () => {
    await start();
    for (const origin of [`http://localhost:${port}`, 'http://127.0.0.1:37777', 'http://[::1]:37777']) {
      const response = await walk({ Origin: origin });
      expect(response.status).toBe(200);
    }
    expect(walks).toBe(3);
  });

  it('rejects a cross-origin page without spawning anything', async () => {
    await start();
    for (const origin of ['https://evil.com', 'http://evil.com:8080', 'null', 'file://', 'http://localhost.evil.com', 'https://localhost:37777', 'not a url']) {
      const response = await walk({ Origin: origin });
      expect(response.status).toBe(403);
      expect((await response.json() as Record<string, string>).error).toBe('Forbidden');
    }
    expect(walks).toBe(0);
  });

  it('rejects on a cross-origin Referer when no Origin was sent', async () => {
    await start();
    const response = await walk({ Referer: 'https://evil.com/some/page' });
    expect(response.status).toBe(403);
    expect(walks).toBe(0);
  });

  it('judges the Origin, not the Referer, when both are present', async () => {
    await start();
    const denied = await walk({ Origin: 'https://evil.com', Referer: `http://localhost:${port}/` });
    expect(denied.status).toBe(403);

    const allowed = await walk({ Origin: `http://localhost:${port}`, Referer: 'https://evil.com/page' });
    expect(allowed.status).toBe(200);
    expect(walks).toBe(1);
  });

  it('leaves the non-spawning search routes alone', async () => {
    await start();
    const response = await fetch(`http://127.0.0.1:${port}/api/search/temporal`.replace('/temporal', '/by-file'), {
      headers: { Origin: 'https://evil.com' },
    });
    // Whatever the by-file handler answers, it is not this gate's 403.
    expect(response.status).not.toBe(403);
  });
});
