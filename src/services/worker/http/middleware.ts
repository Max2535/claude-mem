
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import { getPackageRoot } from '../../../shared/paths.js';
import { logger } from '../../../utils/logger.js';

export function createMiddleware(): RequestHandler[] {
  const middlewares: RequestHandler[] = [];

  middlewares.push(express.json({ limit: '5mb' }));

  middlewares.push((req: Request, res: Response, next: NextFunction) => {
    const staticExtensions = ['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ttf', '.eot'];
    const isStaticAsset = staticExtensions.some(ext => req.path.endsWith(ext));
    const isPollingEndpoint = req.path === '/api/logs'; 
    if (req.path.startsWith('/health') || req.path === '/' || isStaticAsset || isPollingEndpoint) {
      return next();
    }

    const start = Date.now();
    const requestId = `${req.method}-${Date.now()}`;

    const bodySummary = summarizeRequestBody(req.method, req.path, req.body);
    logger.debug('HTTP', `→ ${req.method} ${req.path}`, { requestId }, bodySummary);

    const originalSend = res.send.bind(res);
    res.send = function(body: any) {
      const duration = Date.now() - start;
      logger.debug('HTTP', `← ${res.statusCode} ${req.path}`, { requestId, duration: `${duration}ms` });
      return originalSend(body);
    };

    next();
  });

  const packageRoot = getPackageRoot();
  const uiDir = path.join(packageRoot, 'plugin', 'ui');
  middlewares.push(express.static(uiDir));

  return middlewares;
}

export function createCorsMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin) {
      if (!origin.startsWith('http://localhost:') && !origin.startsWith('http://127.0.0.1:')) {
        next(new Error('CORS not allowed'));
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Hosts a browser page may be served from and still be one of ours. Same set
 * createCorsMiddleware allows, but matched on the parsed host rather than a
 * string prefix, so http://localhost.evil.com cannot pass as localhost.
 */
const LOCAL_BROWSER_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalBrowserOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    // http only, matching the CORS rule: the worker never serves https locally,
    // so an https origin claiming to be localhost is not one of our pages.
    return url.protocol === 'http:' && LOCAL_BROWSER_HOSTS.has(url.hostname);
  } catch {
    // "null" (sandboxed iframe, file://) and anything unparseable land here.
    return false;
  }
}

/**
 * Reject cross-origin browser requests to routes that spawn a subprocess.
 *
 * GET /api/search/temporal is local and unauthenticated, and every request runs
 * a Claude Agent SDK subprocess. Any page in any browser can reach localhost,
 * so without this a visited web page could make the machine spawn agents. The
 * concurrency cap and the 120s timeout bound what that costs; they do not stop
 * it from starting.
 *
 * Non-browser callers — the MCP server, the CLI, curl — send no Origin and no
 * Referer and must still pass; the viewer's own fetch is same-origin, which
 * sends no Origin either but does send a Referer. So: judge the Origin when
 * there is one, fall back to the Referer, and let a request carrying neither
 * through.
 */
export function rejectCrossOriginSubprocessRoutes(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const claimed = typeof origin === 'string' && origin
    ? origin
    : (typeof referer === 'string' && referer ? referer : null);

  if (claimed !== null && !isLocalBrowserOrigin(claimed)) {
    logger.warn('SECURITY', 'Cross-origin request to a subprocess-spawning route denied', {
      endpoint: req.path,
      method: req.method,
      // The header, not the page: a full Referer carries the path the user was on.
      claimedOrigin: origin ? String(origin) : 'referer',
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint does not accept cross-origin requests',
    });
    return;
  }

  next();
}

export function requireLocalhost(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.connection.remoteAddress || '';
  const isLocalhost =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp === 'localhost';

  if (!isLocalhost) {
    logger.warn('SECURITY', 'Admin endpoint access denied - not localhost', {
      endpoint: req.path,
      clientIp,
      method: req.method
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Admin endpoints are only accessible from localhost'
    });
    return;
  }

  next();
}

export function summarizeRequestBody(method: string, path: string, body: any): string {
  if (!body || Object.keys(body).length === 0) return '';

  if (path.includes('/init')) {
    return '';
  }

  if (path.includes('/observations')) {
    const toolName = body.tool_name || '?';
    const toolInput = body.tool_input;
    const toolSummary = logger.formatTool(toolName, toolInput);
    return `tool=${toolSummary}`;
  }

  if (path.includes('/summarize')) {
    return 'requesting summary';
  }

  return '';
}
