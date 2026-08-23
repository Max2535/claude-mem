import React, { useState } from 'react';
import { useTokenBurn } from '../hooks/useTokenBurn';
import { TokenBurnChart } from './TokenBurnChart';
import {
  BurnMetric,
  coverageNotes,
  formatRatio,
  formatTokens,
  formatUsd,
} from '../utils/tokenBurn';

const WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
] as const;

const METRICS: Array<{ id: BurnMetric; label: string }> = [
  { id: 'billableTokens', label: 'Billable' },
  { id: 'totalTokens', label: 'With cache reads' },
];

interface TokenBurnProps {
  currentFilter: string;
}

export function TokenBurn({ currentFilter }: TokenBurnProps) {
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<BurnMetric>('billableTokens');
  const { data, isLoading, error } = useTokenBurn(currentFilter, days);

  const plugin = data?.totals.plugin;
  const user = data?.totals.user;

  const tiles = data
    ? [
        {
          label: 'claude-mem burn',
          value: formatTokens(plugin!.billableTokens),
          // The one cost figure that is real: the SDK reports it per turn.
          note: `${formatUsd(plugin!.costUsd)} · ${plugin!.events.toLocaleString()} calls`,
        },
        {
          label: 'Your sessions',
          value: data.userCaptureEnabled ? formatTokens(user!.billableTokens) : '—',
          note: data.userCaptureEnabled
            ? `${user!.events.toLocaleString()} turns · no price reported`
            : 'capture off',
        },
        {
          label: 'Overhead',
          value: formatRatio(data.totals.overheadRatio),
          note: 'of your own burn',
        },
        {
          label: 'Cache reads',
          value: formatTokens(plugin!.cacheReadTokens + user!.cacheReadTokens),
          note: 'billed at ~10%',
        },
      ]
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Token Burn</h1>
        <p className="page-subtitle">
          What claude-mem spends, next to what your own sessions spend.
        </p>
      </div>

      <div className="stat-tiles">
        {!data && isLoading && <div className="stat-tiles-placeholder">Loading token burn…</div>}
        {!data && !isLoading && (
          <div className="stat-tiles-placeholder">
            {error ? `Token burn unavailable — ${error}` : 'No token burn recorded yet.'}
          </div>
        )}
        {tiles.map(tile => (
          <div className="stat-tile" key={tile.label}>
            <div className="stat-tile-label">{tile.label}</div>
            <div className="stat-tile-value">{tile.value}</div>
            <div className="stat-tile-note">{tile.note}</div>
          </div>
        ))}
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div>
            <div className="chart-title">Tokens per day</div>
            <div className="chart-subtitle">
              {metric === 'billableTokens'
                ? 'Input, cache writes and output. Cache reads are excluded — they bill at roughly a tenth.'
                : 'Everything, cache reads included. The plugin reads a large cached context each turn.'}
            </div>
          </div>
          <div className="chart-controls">
            <div className="chart-range">
              {METRICS.map(option => (
                <button key={option.id}
                        className={`chart-range-btn ${metric === option.id ? 'is-active' : ''}`}
                        onClick={() => setMetric(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="chart-range">
              {WINDOWS.map(option => (
                <button key={option.days}
                        className={`chart-range-btn ${days === option.days ? 'is-active' : ''}`}
                        onClick={() => setDays(option.days)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <TokenBurnChart buckets={data?.buckets ?? []} metric={metric} />
      </div>

      {/* Coverage gaps are stated, never implied by an empty line. */}
      <ul className="burn-note">
        {coverageNotes(data).map(note => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
