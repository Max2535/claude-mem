import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import express from 'express';
import http from 'http';
import { tools } from '../../src/servers/mcp-server.js';
import { clearPortCache } from '../../src/shared/worker-utils.js';
import { SearchRoutes } from '../../src/services/worker/http/routes/SearchRoutes.js';
import { SearchManager } from '../../src/services/worker/SearchManager.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { VectorlessSearchStrategy } from '../../src/services/worker/search/strategies/VectorlessSearchStrategy.js';

/**
 * temporal_search is the surface an agent actually calls, and until this test
 * it had only ever been typechecked: the HTTP route below it had e2e coverage,
 * the tool above it had none. It runs the registered handler the way the
 * CallTool dispatcher does, against a real worker route on a real (in-memory)
 * database, with the traversal LLM stubbed — nothing here spawns a subprocess
 * or calls a model.
 */
describe('temporal_search over MCP', () => {
  let store: SessionStore;
  let server: http.Server;
  let previousPort: string | undefined;
  let previousHost: string | undefined;

  const tool = tools.find(t => t.name === 'temporal_search')!;

  function seed(title: string, platformSource: string): void {
    const sdkId = store.createSDKSession(`sess-${title}`, 'walk-project', 'prompt', undefined, platformSource);
    store.ensureMemorySessionIdRegistered(sdkId, `mem-${title}`);
    store.storeObservation(`mem-${title}`, 'walk-project', {
      type: 'discovery',
      title,
      subtitle: null,
      facts: [],
      narrative: 'worker restart handling',
      concepts: [],
      files_read: [],
      files_modified: [],
    }, 1);
  }

  /**
   * Boots the worker route in-process and points the MCP client's worker URL at
   * it. `vectorless` null leaves the strategy off, which is the disabled state.
   */
  async function startWorker(vectorless: 'on' | 'off'): Promise<void> {
    store = new SessionStore(':memory:');
    const search = new SessionSearch(store.db);
    seed('restart-fix', 'claude');
    seed('codex-note', 'codex');

    const manager = new SearchManager(search, store, null, {} as any, {} as any);
    if (vectorless === 'on') {
      // The traversal answer is scripted, so no SDK subprocess is involved.
      (manager as any).vectorlessStrategy = new VectorlessSearchStrategy(
        search,
        async (prompt: string) => {
          const line = prompt.split('\n').find(l => l.includes('restart-fix'));
          const id = line ? Number(line.match(/^\[(\d+)\]/)?.[1]) : NaN;
          return JSON.stringify({ ids: Number.isNaN(id) ? [] : [id] });
        },
        { maxIndexRows: 500, maxDays: 14 },
      );
      (manager as any).orchestrator.vectorlessStrategy = (manager as any).vectorlessStrategy;
    } else {
      (manager as any).vectorlessStrategy = null;
    }

    const app = express();
    new SearchRoutes(manager).setupRoutes(app);
    const port = 41000 + Math.floor(Math.random() * 10000);
    await new Promise<void>(resolve => {
      server = app.listen(port, '127.0.0.1', resolve);
    });

    process.env.CLAUDE_MEM_WORKER_PORT = String(port);
    process.env.CLAUDE_MEM_WORKER_HOST = '127.0.0.1';
    clearPortCache();
  }

  beforeEach(() => {
    previousPort = process.env.CLAUDE_MEM_WORKER_PORT;
    previousHost = process.env.CLAUDE_MEM_WORKER_HOST;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }
    store?.close();
    if (previousPort === undefined) delete process.env.CLAUDE_MEM_WORKER_PORT;
    else process.env.CLAUDE_MEM_WORKER_PORT = previousPort;
    if (previousHost === undefined) delete process.env.CLAUDE_MEM_WORKER_HOST;
    else process.env.CLAUDE_MEM_WORKER_HOST = previousHost;
    clearPortCache();
  });

  it('is registered with a handler the dispatcher can call', () => {
    expect(typeof tool.handler).toBe('function');
    expect(tool.inputSchema.required).toEqual(['query']);
  });

  it('returns a walk with its traversal and coverage, in MCP content shape', async () => {
    await startWorker('on');

    const result = await tool.handler({ query: 'worker restart', limit: 5 }) as any;

    // Every tool result must carry a content array; the temporal endpoint
    // answers with plain search JSON, so the tool is what owes the envelope.
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.isError).toBeFalsy();

    const body = JSON.parse(result.content[0].text);
    expect(body.strategy).toBe('vectorless');
    expect(body.observations.map((o: any) => o.title)).toEqual(['restart-fix']);
    expect(body.traversal).toMatchObject({ rounds: expect.any(Number), indexRows: 2 });
    expect(body.coverage.indexed).toEqual({ claude: 1, codex: 1 });
    expect(body.coverage.matched).toEqual({ claude: 1 });
    expect(body.coverage.total).toEqual({ claude: 1, codex: 1 });
  });

  it('reports the disabled state instead of looking like an empty memory', async () => {
    await startWorker('off');

    const result = await tool.handler({ query: 'worker restart' }) as any;

    expect(Array.isArray(result.content)).toBe(true);
    expect(result.isError).toBe(true);
    const text = result.content.map((part: any) => part.text).join('\n');
    expect(text).toContain('Vectorless retrieval is disabled');
    expect(text).toContain('CLAUDE_MEM_VECTORLESS_ENABLED=true');
  });
});
