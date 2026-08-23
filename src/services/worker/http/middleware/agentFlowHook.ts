import type { Application, Request, Response, NextFunction } from 'express';
import type { SSEBroadcaster } from '../../SSEBroadcaster.js';
import type { AgentFlowStage } from '../../events/AgentFlowBuffer.js';
import { logger } from '../../../../utils/logger.js';
import { getProjectContext } from '../../../../utils/project-name.js';

/**
 * The hook-facing endpoints, and the Agent Flow stage each one marks.
 *
 * Instrumenting here rather than inside the four handlers is deliberate: every
 * one of them has early returns, and an emit per exit path is exactly the kind
 * of coverage that rots. One `finish` listener sees every response, including
 * the ones that threw.
 */
const HOOK_ROUTES: ReadonlyMap<string, { stage: AgentFlowStage; label: string }> = new Map([
  ['/api/sessions/init', { stage: 'hook_received', label: 'session-init' }],
  ['/api/sessions/observations', { stage: 'hook_received', label: 'observation' }],
  ['/api/sessions/summarize', { stage: 'hook_received', label: 'summarize' }],
  ['/api/context/inject', { stage: 'context_injected', label: 'context' }],
]);

/** Handlers may enrich their own event by writing here before responding. */
export interface AgentFlowLocals {
  agentFlowDetail?: string;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/**
 * Emit one Agent Flow event per hook callback the worker serves.
 *
 * Register this BEFORE the route handlers — express runs middleware in
 * registration order, and the `finish` listener must be attached before the
 * handler can end the response.
 */
export function createAgentFlowHookMiddleware(sseBroadcaster: SSEBroadcaster) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const route = HOOK_ROUTES.get(req.path);
    if (!route) {
      next();
      return;
    }

    // Read the identifiers now: a handler is free to mutate req.body, and by
    // `finish` the query string is the only field guaranteed untouched.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const contentSessionId =
      firstString(body.contentSessionId) ?? firstString(req.query.contentSessionId);
    // Each hook names its project differently, and none of them can be missed:
    // an event with a null project is invisible the moment a viewer filters.
    // `projects` is the worktree-aware comma list /api/context/inject takes;
    // `cwd` is all the observation hook sends, so derive from it last.
    const project =
      firstString(body.project) ??
      firstString(req.query.project) ??
      firstString(req.query.projects)?.split(',')[0]?.trim() ??
      (firstString(body.cwd) ? getProjectContext(firstString(body.cwd)).primary : null);

    res.on('finish', () => {
      try {
        const locals = res.locals as AgentFlowLocals;
        sseBroadcaster.emitFlow({
          stage: route.stage,
          project,
          contentSessionId,
          sessionDbId: null,
          // Never req.body — a hook payload carries tool input and prompt text.
          detail: locals.agentFlowDetail ?? route.label,
          outcome: res.statusCode < 400 ? 'ok' : 'error',
        });
      } catch (error) {
        // A live-monitor event is never worth destabilising a hook callback.
        // The response is already sent by now, but an uncaught throw in a
        // 'finish' listener takes down the process.
        logger.warn('HTTP', 'Agent Flow emit failed', {
          path: req.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    next();
  };
}

/** Adapter so the middleware registers through Server.registerRoutes(). */
export function agentFlowHookRoutes(sseBroadcaster: SSEBroadcaster) {
  const middleware = createAgentFlowHookMiddleware(sseBroadcaster);
  return {
    setupRoutes(app: Application): void {
      app.use(middleware);
    },
  };
}
