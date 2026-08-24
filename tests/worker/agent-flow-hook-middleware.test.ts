import { describe, expect, it } from 'bun:test';
import express from 'express';
import { SSEBroadcaster } from '../../src/services/worker/SSEBroadcaster.js';
import { createAgentFlowHookMiddleware } from '../../src/services/worker/http/middleware/agentFlowHook.js';
import type { AgentFlowEvent } from '../../src/services/worker/events/AgentFlowBuffer.js';

async function callRoute(
  path: string,
  body: unknown,
  handler: express.RequestHandler
): Promise<AgentFlowEvent[]> {
  const broadcaster = new SSEBroadcaster();
  const app = express();
  app.use(express.json());
  app.use(createAgentFlowHookMiddleware(broadcaster));
  app.post(path, handler);
  app.get(path, handler);

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // The emit rides res.on('finish'), which fires after the client's promise
    // resolves — yield once so the listener has run.
    await new Promise(resolve => setTimeout(resolve, 20));
    return broadcaster.getFlowBacklog();
  } finally {
    server.close();
  }
}

describe('agent flow hook middleware', () => {
  it('emits one event per hook callback, labelled by route', async () => {
    const events = await callRoute(
      '/api/sessions/observations',
      { contentSessionId: 'cs-9', project: 'demo' },
      (_req, res) => { res.json({ ok: true }); }
    );

    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe('hook_received');
    expect(events[0].detail).toBe('observation');
    expect(events[0].contentSessionId).toBe('cs-9');
    expect(events[0].project).toBe('demo');
    expect(events[0].outcome).toBe('ok');
  });

  it('marks a failed hook as an error rather than dropping it', async () => {
    const events = await callRoute(
      '/api/sessions/init',
      { contentSessionId: 'cs-1' },
      (_req, res) => { res.status(500).json({ error: 'boom' }); }
    );

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('error');
  });

  it('lets a handler enrich the detail through res.locals', async () => {
    const events = await callRoute(
      '/api/context/inject',
      undefined,
      (_req, res) => {
        (res.locals as { agentFlowDetail?: string }).agentFlowDetail = 'context · 2064 chars';
        res.send('memory');
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe('context_injected');
    expect(events[0].detail).toBe('context · 2064 chars');
  });

  it('derives the project from cwd when the hook body omits it', async () => {
    const events = await callRoute(
      '/api/sessions/observations',
      { contentSessionId: 'cs-3', cwd: '/Users/someone/projects/widget-factory' },
      (_req, res) => { res.json({ ok: true }); }
    );

    expect(events[0].project).toBe('widget-factory');
  });

  it('reads the worktree-aware projects list used by context injection', async () => {
    const broadcaster = new (await import('../../src/services/worker/SSEBroadcaster.js')).SSEBroadcaster();
    const app = express();
    app.use(express.json());
    app.use(createAgentFlowHookMiddleware(broadcaster));
    app.get('/api/context/inject', (_req, res) => { res.send('memory'); });

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      await fetch(`http://127.0.0.1:${port}/api/context/inject?projects=alpha,beta`);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(broadcaster.getFlowBacklog()[0].project).toBe('alpha');
    } finally {
      server.close();
    }
  });

  it('ignores routes that are not hook callbacks', async () => {
    const events = await callRoute(
      '/api/search',
      undefined,
      (_req, res) => { res.json({ results: [] }); }
    );

    expect(events).toEqual([]);
  });

  it('never copies the request body into the event', async () => {
    const secret = 'PLEASE_DO_NOT_LEAK_THIS_PROMPT';
    const events = await callRoute(
      '/api/sessions/observations',
      {
        contentSessionId: 'cs-2',
        tool_name: 'Read',
        tool_input: { file_path: `/secret/${secret}` },
        tool_response: secret,
      },
      (_req, res) => { res.json({ ok: true }); }
    );

    expect(JSON.stringify(events)).not.toContain(secret);
  });
});
