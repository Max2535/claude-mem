/**
 * Everything the System screen says about the worker, derived from the probe
 * responses and nothing else. No endpoint here is new: /api/health,
 * /api/stats, /api/chroma/status, /api/mcp/status and /api/sync/status all
 * already exist and are already read by the CLI and the installer.
 *
 * The one rule this file exists to enforce: a probe that did not answer is
 * reported as unread, never as healthy and never as broken. "I could not tell"
 * is a real answer and the screen has to be able to give it.
 */

export interface DependencyStatus {
  dependency: string;
  kind: string;
  message: string;
  remediation?: string;
  recordedAtMs: number;
}

export interface WorkerHealth {
  status?: string;
  version?: string;
  uptime?: number;
  pid?: number;
  platform?: string;
  managed?: boolean;
  initialized?: boolean;
  mcpReady?: boolean;
  ai?: { provider?: string; authMethod?: string; lastInteraction?: string | null };
  dependencies?: { degraded: boolean; statuses: DependencyStatus[] };
  queue?: { engine?: string; redis?: { status?: string } };
}

export interface ChromaStatus {
  status?: string;
  connected?: boolean;
  details?: string;
}

export interface McpStatus {
  enabled?: boolean;
}

export interface SyncStatus {
  configured?: boolean;
  lastError?: string | null;
  pending?: Record<string, number>;
  hub?: { reachable?: boolean | null; error?: string | null; checkedAt?: number | null };
}

/**
 * One endpoint's outcome. `data: null` with `read: false` is the "did not
 * answer" case; a body that arrived under any status code is still data,
 * because /api/health answers 503 with the very payload that explains why.
 */
export interface Probe<T> {
  data: T | null;
  read: boolean;
}

export const UNREAD: Probe<never> = { data: null, read: false };

export type ServiceState = 'ok' | 'off' | 'problem' | 'unknown';

export interface ServiceRow {
  key: string;
  name: string;
  state: ServiceState;
  /** The state in words, so the colour is never the only carrier. */
  value: string;
  detail: string;
  remediation?: string;
}

const UNREAD_DETAIL = 'The worker did not answer this probe.';

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * The worker names its dependencies in snake_case. Title-casing them
 * generically would produce "Claude Cli", so the three it can actually report
 * are spelled out and anything new falls back to the raw name.
 */
const DEPENDENCY_NAMES: Record<string, string> = {
  claude_cli: 'Claude CLI',
  uvx: 'uvx',
  chroma: 'Chroma',
};

/** Rows the worker only produces when something is actually wrong. */
function dependencyRows(health: Probe<WorkerHealth>): ServiceRow[] {
  return (health.data?.dependencies?.statuses ?? []).map(status => ({
    key: `dependency:${status.dependency}`,
    name: DEPENDENCY_NAMES[status.dependency] ?? status.dependency,
    state: 'problem' as const,
    value: 'Needs attention',
    detail: status.message,
    remediation: status.remediation,
  }));
}

function chromaRow(chroma: Probe<ChromaStatus>): ServiceRow {
  const base = { key: 'chroma', name: 'Semantic search' };
  if (!chroma.read || !chroma.data) {
    return { ...base, state: 'unknown', value: 'Unread', detail: UNREAD_DETAIL };
  }
  const { status, details } = chroma.data;
  const detail = details ?? '';
  if (status === 'disabled') return { ...base, state: 'off', value: 'Off', detail };
  if (status === 'healthy') return { ...base, state: 'ok', value: 'Connected', detail };
  return {
    ...base,
    state: 'problem',
    value: 'Unreachable',
    detail,
    remediation: 'Keyword search still answers; only the vector half is down.',
  };
}

function mcpRow(mcp: Probe<McpStatus>): ServiceRow {
  const base = { key: 'mcp', name: 'MCP server' };
  if (!mcp.read || !mcp.data) {
    return { ...base, state: 'unknown', value: 'Unread', detail: UNREAD_DETAIL };
  }
  return mcp.data.enabled
    ? { ...base, state: 'ok', value: 'Registered', detail: 'Claude Code can call the claude-mem tools.' }
    : { ...base, state: 'off', value: 'Not registered', detail: 'Memory is still captured; the search tools are not exposed to Claude Code.' };
}

function syncRow(sync: Probe<SyncStatus>): ServiceRow {
  const base = { key: 'sync', name: 'Cloud sync' };
  if (!sync.read || !sync.data) {
    return { ...base, state: 'unknown', value: 'Unread', detail: UNREAD_DETAIL };
  }
  if (!sync.data.configured) {
    return { ...base, state: 'off', value: 'Not set up', detail: 'This database lives on this machine only.' };
  }
  const pending = Object.values(sync.data.pending ?? {}).reduce((sum, n) => sum + (n || 0), 0);
  const error = sync.data.hub?.error ?? sync.data.lastError;
  if (error) {
    return { ...base, state: 'problem', value: 'Failing', detail: error, remediation: `${pending} record${pending === 1 ? '' : 's'} waiting to upload.` };
  }
  return {
    ...base,
    state: 'ok',
    value: pending === 0 ? 'Up to date' : `${pending} queued`,
    detail: 'The hub answered a read-only status check.',
  };
}

function aiRow(health: Probe<WorkerHealth>): ServiceRow {
  const base = { key: 'ai', name: 'Compression model' };
  if (!health.read || !health.data) {
    return { ...base, state: 'unknown', value: 'Unread', detail: UNREAD_DETAIL };
  }
  const ai = health.data.ai;
  if (!ai?.provider) {
    return { ...base, state: 'unknown', value: 'Unread', detail: 'The worker reported no provider.' };
  }
  // The pill carries a state, not a name: "claude" in a green pill reads as
  // if the provider were the condition being reported.
  return {
    ...base,
    state: 'ok',
    value: 'Configured',
    detail: ai.authMethod ? `${ai.provider} · ${ai.authMethod}` : ai.provider,
  };
}

/**
 * Dependency problems come first because the worker only emits them when
 * something is broken; the four standing services keep a fixed order after
 * them, so a healthy screen never reshuffles itself between polls.
 */
export function describeServices(probes: {
  health: Probe<WorkerHealth>;
  chroma: Probe<ChromaStatus>;
  mcp: Probe<McpStatus>;
  sync: Probe<SyncStatus>;
}): ServiceRow[] {
  return [
    ...dependencyRows(probes.health),
    chromaRow(probes.chroma),
    mcpRow(probes.mcp),
    syncRow(probes.sync),
    aiRow(probes.health),
  ];
}
