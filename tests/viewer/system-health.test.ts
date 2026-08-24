import { describe, it, expect } from 'bun:test';
import {
  describeServices,
  formatBytes,
  formatUptime,
  UNREAD,
  type Probe,
  type ServiceRow,
  type WorkerHealth,
} from '../../src/ui/viewer/utils/systemHealth.js';

function read<T>(data: T): Probe<T> {
  return { data, read: true };
}

const ALL_UNREAD = { health: UNREAD, chroma: UNREAD, mcp: UNREAD, sync: UNREAD };

function find(rows: ServiceRow[], key: string): ServiceRow {
  const row = rows.find(r => r.key === key);
  if (!row) throw new Error(`no ${key} row`);
  return row;
}

describe('formatUptime', () => {
  it('climbs from seconds to days without ever showing a bare number', () => {
    expect(formatUptime(42)).toBe('42s');
    expect(formatUptime(600)).toBe('10m');
    expect(formatUptime(3600 * 2 + 900)).toBe('2h 15m');
    expect(formatUptime(86400 * 3 + 3600 * 4)).toBe('3d 4h');
  });

  it('refuses to invent a duration from a missing one', () => {
    expect(formatUptime(NaN)).toBe('—');
    expect(formatUptime(-1)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('keeps a tile value short at every magnitude', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(929792)).toBe('908 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

describe('describeServices', () => {
  it('reports every service as unread rather than healthy when nothing answered', () => {
    const rows = describeServices(ALL_UNREAD);
    expect(rows.map(r => r.key)).toEqual(['chroma', 'mcp', 'sync', 'ai']);
    expect(rows.every(r => r.state === 'unknown')).toBe(true);
    // Silence is never painted as a failure either — that would accuse the
    // wrong component.
    expect(rows.some(r => r.state === 'problem')).toBe(false);
  });

  it('separates a disabled service from a broken one', () => {
    const off = find(describeServices({ ...ALL_UNREAD, chroma: read({ status: 'disabled', details: 'off by setting' }) }), 'chroma');
    expect(off.state).toBe('off');

    const broken = find(describeServices({ ...ALL_UNREAD, chroma: read({ status: 'unhealthy', details: 'health check failed' }) }), 'chroma');
    expect(broken.state).toBe('problem');
    expect(broken.remediation).toContain('Keyword search');
  });

  it('puts dependency problems above the standing services', () => {
    const health: WorkerHealth = {
      status: 'ok',
      dependencies: {
        degraded: true,
        statuses: [{ dependency: 'claude_cli', kind: 'setup_required', message: 'not found', remediation: 'install it', recordedAtMs: 0 }],
      },
    };
    const rows = describeServices({ ...ALL_UNREAD, health: read(health) });
    expect(rows[0].key).toBe('dependency:claude_cli');
    expect(rows[0].state).toBe('problem');
    expect(rows[0].name).toBe('Claude CLI');
    expect(rows[0].remediation).toBe('install it');
  });

  it('draws no dependency row while nothing is degraded', () => {
    const rows = describeServices({ ...ALL_UNREAD, health: read({ status: 'ok', dependencies: { degraded: false, statuses: [] } }) });
    expect(rows.some(r => r.key.startsWith('dependency:'))).toBe(false);
  });

  it('counts every pending kind when sync has a backlog', () => {
    const row = find(describeServices({
      ...ALL_UNREAD,
      sync: read({ configured: true, pending: { observations: 2, summaries: 1, prompts: 0, mutations: 0, tombstones: 3 } }),
    }), 'sync');
    expect(row.state).toBe('ok');
    expect(row.value).toBe('6 queued');
  });

  it('believes the hub error over an empty queue', () => {
    const row = find(describeServices({
      ...ALL_UNREAD,
      sync: read({ configured: true, pending: {}, hub: { reachable: false, error: 'sync hub status 401' } }),
    }), 'sync');
    expect(row.state).toBe('problem');
    expect(row.detail).toBe('sync hub status 401');
  });

  it('calls an unconfigured sync off, not missing', () => {
    const row = find(describeServices({ ...ALL_UNREAD, sync: read({ configured: false }) }), 'sync');
    expect(row.state).toBe('off');
  });

  it('reads a degraded health body the same way it reads a healthy one', () => {
    // /api/health answers 503 when the queue is degraded; the hook still hands
    // the body over, and the AI row must survive that.
    const row = find(describeServices({
      ...ALL_UNREAD,
      health: read({ status: 'degraded', ai: { provider: 'claude', authMethod: 'OAuth token' } }),
    }), 'ai');
    expect(row.state).toBe('ok');
    expect(row.value).toBe('Configured');
    expect(row.detail).toBe('claude · OAuth token');
  });

  it('says so when the MCP tools are not exposed', () => {
    const row = find(describeServices({ ...ALL_UNREAD, mcp: read({ enabled: false }) }), 'mcp');
    expect(row.state).toBe('off');
    expect(row.detail).toContain('still captured');
  });
});
