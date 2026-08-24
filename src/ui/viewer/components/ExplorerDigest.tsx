import React, { useMemo } from 'react';
import { buildDayDigest, DigestTally } from '../utils/explorerDigest';
import { ExplorerDayObservation } from '../types';

function clock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function minutes(ms: number): string {
  const total = Math.round(ms / 60000);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * A share bar rather than a pie: the reader is comparing magnitudes, and the
 * count sits beside every row so the bar never has to be measured by eye.
 */
function Breakdown({ title, rows, total }: { title: string; rows: DigestTally[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <section className="digest-breakdown">
      <h3 className="digest-breakdown-title">{title}</h3>
      <ul className="digest-rows">
        {rows.map(row => (
          <li className="digest-row" key={row.name}>
            <span className="digest-row-name">{row.name}</span>
            <span className="digest-row-bar">
              <span className="digest-row-fill" style={{ width: `${(row.count / total) * 100}%` }} />
            </span>
            <span className="digest-row-count">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExplorerDigest({ observations }: { observations: ExplorerDayObservation[] }) {
  const digest = useMemo(() => buildDayDigest(observations), [observations]);

  if (digest.total === 0) {
    return <div className="tree-graph-empty">Nothing recorded on this day.</div>;
  }

  const span = digest.span!;
  const busiest = digest.busiest!;

  const tiles = [
    { label: 'Observations', value: String(digest.total), note: `${digest.blocks} block${digest.blocks === 1 ? '' : 's'} of work` },
    { label: 'Sessions', value: String(digest.sessions), note: `${digest.prompts} prompt${digest.prompts === 1 ? '' : 's'} produced memory` },
    { label: 'First to last', value: `${clock(span.start)}–${clock(span.end)}`, note: minutes(span.end - span.start) },
    // On a single-block day the busiest stretch *is* the whole day, and the
    // tile would restate its neighbour; spend the slot on the spread instead.
    digest.blocks > 1
      ? { label: 'Busiest stretch', value: `${clock(busiest.start)}–${clock(busiest.end)}`, note: `${busiest.count} observations` }
      : { label: 'Projects', value: String(digest.projects.length), note: `via ${digest.sources.map(s => s.name).join(', ')}` },
  ];

  return (
    <div className="digest">
      <div className="stat-tiles">
        {tiles.map(tile => (
          <div className="stat-tile" key={tile.label}>
            <div className="stat-tile-label">{tile.label}</div>
            <div className="stat-tile-value">{tile.value}</div>
            <div className="stat-tile-note">{tile.note}</div>
          </div>
        ))}
      </div>

      {/* One row is not a breakdown — it is the whole day, and a single
          full-width bar says nothing the tiles have not already said. */}
      {digest.types.length > 1 && <Breakdown title="By type" rows={digest.types} total={digest.total} />}
      {digest.projects.length > 1 && <Breakdown title="By project" rows={digest.projects} total={digest.total} />}
      {digest.sources.length > 1 && <Breakdown title="By source" rows={digest.sources} total={digest.total} />}
    </div>
  );
}
