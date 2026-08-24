import type { TokenBurnBucket, TokenBurnResponse, TokenBurnTotals } from '../types';

/** Which number the chart is drawing. */
export type BurnMetric = 'billableTokens' | 'totalTokens';

export interface BurnPoint {
  bucket: string;
  value: number;
  x: number;
  y: number;
}

export interface BurnSeries {
  key: 'plugin' | 'user';
  label: string;
  points: BurnPoint[];
}

export interface BurnPlot {
  series: BurnSeries[];
  /** Zero-based, so a rise is proportional to the rise in spend. */
  yMax: number;
  width: number;
  height: number;
}

export const BURN_SERIES_LABELS: Record<'plugin' | 'user', string> = {
  plugin: 'claude-mem',
  user: 'Your sessions',
};

/**
 * Maps buckets to plot coordinates.
 *
 * The y-scale always starts at zero. A truncated baseline on a filled area
 * makes a 3% change look like a doubling, and this chart exists to answer
 * "how much" — a question a misleading scale answers wrongly.
 */
export function buildPlot(
  buckets: TokenBurnBucket[],
  metric: BurnMetric,
  width: number,
  height: number
): BurnPlot {
  const keys: Array<'plugin' | 'user'> = ['plugin', 'user'];
  const peak = buckets.reduce(
    (max, bucket) => Math.max(max, bucket.plugin[metric], bucket.user[metric]),
    0
  );
  // A flat-zero window still needs a scale, or every point divides by zero.
  const yMax = peak > 0 ? peak * 1.1 : 1;
  const lastIndex = Math.max(buckets.length - 1, 1);

  const series = keys.map(key => ({
    key,
    label: BURN_SERIES_LABELS[key],
    points: buckets.map((bucket, index) => {
      const value = bucket[key][metric];
      return {
        bucket: bucket.bucket,
        value,
        x: (index / lastIndex) * width,
        y: height - (value / yMax) * height,
      };
    }),
  }));

  return { series, yMax, width, height };
}

/**
 * An SVG path through the points, straight segments only.
 *
 * No curve smoothing: a spline between two daily samples draws spend on days
 * that did not have it, and a reader cannot tell the invented part from the
 * measured part.
 */
export function linePath(points: BurnPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // One sample is a mark, not a line — give it width so it is visible.
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.01} ${points[0].y}`;
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** The line closed down to the baseline, for the fill underneath it. */
export function areaPath(points: BurnPoint[], height: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L ${last.x} ${height} L ${first.x} ${height} Z`;
}

/**
 * The bucket index nearest an x position.
 *
 * Hover is driven by one overlay rectangle rather than a hit target per point:
 * a 365-day window would otherwise be 365 elements competing for the pointer.
 */
export function nearestIndex(x: number, count: number, width: number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const step = width / (count - 1);
  const index = Math.round(x / step);
  return Math.min(Math.max(index, 0), count - 1);
}

/** 1284 -> "1,284"; 12904 -> "12.9K". Matches the stat-tile convention. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 10000) return Math.round(n).toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

/**
 * Costs the plugin actually reported. An unpriced series renders as an em
 * dash, never as $0.00 — claiming a spend was free is worse than admitting it
 * is unknown.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
}

/** "Jun 3" — the axis has no room for a year that never changes mid-window. */
export function formatBucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split('-').map(Number);
  if (!year || !month || !day) return bucket;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Roughly evenly spaced bucket indices for the x axis.
 *
 * Always includes the last bucket: the right edge is "now", and an axis whose
 * final label is three days stale misreads the whole chart.
 */
export function tickIndices(count: number, maxTicks = 6): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxTicks - 1);
  const ticks = Array.from({ length: maxTicks }, (_, i) => Math.round(i * step));
  return [...new Set(ticks)];
}

/**
 * What the screen must disclose about coverage. Returned as sentences rather
 * than booleans so a gap can never be silently dropped by the component.
 */
export function coverageNotes(data: TokenBurnResponse | null): string[] {
  if (!data) return [];
  const notes: string[] = [];
  if (!data.userCaptureEnabled) {
    notes.push('Session capture is off — the "Your sessions" line reads zero because nothing is being recorded, not because nothing was spent. Set CLAUDE_MEM_TOKEN_BURN_CAPTURE to true to turn it on.');
  }
  notes.push('Cost is reported by the SDK for claude-mem’s own calls only. Claude Code transcripts carry token counts but no price, so your own sessions have no dollar figure here.');
  if (data.platformsCovered.length === 1 && data.platformsCovered[0] === 'claude') {
    notes.push('Session tokens are read from Claude Code transcripts. Codex and Cursor sessions are not counted.');
  }
  notes.push(data.since
    ? `History starts ${formatBucketLabel(data.since)} — nothing was recorded before this feature was installed.`
    : 'Nothing recorded yet. Numbers appear after the next compression or the next turn you finish.');
  return notes;
}

export function isEmptyPlot(buckets: TokenBurnBucket[], metric: BurnMetric): boolean {
  return buckets.every(b => b.plugin[metric] === 0 && b.user[metric] === 0);
}

export function emptyTotals(): TokenBurnTotals {
  return {
    inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0,
    billableTokens: 0, totalTokens: 0, costUsd: null, events: 0,
  };
}
