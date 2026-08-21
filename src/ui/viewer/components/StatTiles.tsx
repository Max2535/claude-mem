import React from 'react';
import { WorkerStats } from '../types';

/** 1284 -> "1,284"; 12904 -> "12.9K". Keeps a tile value from wrapping. */
function compact(n: number): string {
  if (n < 10000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StatTilesProps {
  stats: WorkerStats | null;
  error: boolean;
}

export function StatTiles({ stats, error }: StatTilesProps) {
  const tiles = stats
    ? [
        { label: 'Observations', value: compact(stats.database.observations), note: formatBytes(stats.database.size) },
        { label: 'Sessions', value: compact(stats.database.sessions), note: `${stats.worker.activeSessions} active` },
        { label: 'Summaries', value: compact(stats.database.summaries), note: `v${stats.worker.version}` },
        { label: 'Worker uptime', value: formatUptime(stats.worker.uptime), note: `port ${stats.worker.port}` },
      ]
    : [];

  return (
    <div className="stat-tiles">
      {stats === null && !error && (
        <div className="stat-tiles-placeholder">Loading stats…</div>
      )}
      {stats === null && error && (
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
  );
}
