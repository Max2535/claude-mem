import React, { useMemo } from 'react';
import { LogConsole } from './LogConsole';
import { useSystemHealth } from '../hooks/useSystemHealth';
import { describeServices, formatBytes, formatUptime, ServiceRow } from '../utils/systemHealth';
import { WorkerStats } from '../types';

interface SystemProps {
  stats: WorkerStats | null;
  statsError: boolean;
  isProcessing: boolean;
  queueDepth: number;
}

function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function Service({ row }: { row: ServiceRow }) {
  return (
    <li className="service-row">
      <div className="service-head">
        <span className="service-name">{row.name}</span>
        {/* The word carries the state; the colour only repeats it, so a
            reader who cannot separate the hues loses nothing. */}
        <span className={`service-pill is-${row.state}`}>{row.value}</span>
      </div>
      {row.detail && <p className="service-detail">{row.detail}</p>}
      {row.remediation && <p className="service-fix">{row.remediation}</p>}
    </li>
  );
}

export function System({ stats, statsError, isProcessing, queueDepth }: SystemProps) {
  const { health, chroma, mcp, sync, checkedAt, refresh, isRefreshing } = useSystemHealth();

  const services = useMemo(
    () => describeServices({ health, chroma, mcp, sync }),
    [health, chroma, mcp, sync]
  );

  const worker = health.data;
  const workerState = !health.read ? 'Unreachable' : worker?.status === 'ok' ? 'Running' : 'Degraded';

  const tiles = [
    {
      label: 'Worker',
      value: workerState,
      note: worker ? `v${worker.version} · pid ${worker.pid}` : 'no answer on this port',
    },
    {
      label: 'Uptime',
      value: worker?.uptime !== undefined ? formatUptime(worker.uptime) : '—',
      note: stats ? `port ${stats.worker.port} · ${stats.worker.sseClients} viewers` : 'stats unread',
    },
    {
      // The queue is the thing that makes memory appear late, so it gets a
      // tile of its own rather than a line in the log.
      label: 'Queue',
      value: isProcessing ? `${queueDepth} waiting` : 'Idle',
      note: stats ? `${stats.worker.activeSessions} active sessions` : 'stats unread',
    },
    {
      label: 'Database',
      value: stats ? formatBytes(stats.database.size) : '—',
      note: stats ? `${stats.database.observations.toLocaleString()} observations` : 'stats unread',
    },
  ];

  return (
    <div className="page">
      <header className="page-head system-head">
        <div>
          <h1 className="page-title">System</h1>
          <p className="page-subtitle">
            {checkedAt ? `Last checked at ${clock(checkedAt)}` : 'Checking…'}
          </p>
        </div>
        <button type="button" className="system-refresh" onClick={refresh} disabled={isRefreshing}>
          {isRefreshing ? 'Checking…' : 'Check now'}
        </button>
      </header>

      <div className="stat-tiles">
        {statsError && !stats && (
          <div className="stat-tiles-placeholder">Stats unavailable — is the worker running?</div>
        )}
        {tiles.map(tile => (
          <div className="stat-tile" key={tile.label}>
            <div className="stat-tile-label">{tile.label}</div>
            <div className="stat-tile-value">{tile.value}</div>
            <div className="stat-tile-note">{tile.note}</div>
          </div>
        ))}
      </div>

      <section className="system-section">
        <h2 className="system-section-title">Services</h2>
        <ul className="service-list">
          {services.map(row => <Service key={row.key} row={row} />)}
        </ul>
      </section>

      <section className="system-section">
        <h2 className="system-section-title">Worker log</h2>
        {/* The same console the floating drawer mounts — one implementation,
            two places to stand. */}
        <div className="system-console">
          <LogConsole />
        </div>
      </section>
    </div>
  );
}
