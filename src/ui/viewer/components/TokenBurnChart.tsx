import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
/**
 * Two token series over local days: what claude-mem spent, and what the
 * operator's own sessions spent.
 *
 * Hand-rolled SVG, like every other chart here — no chart library is bundled
 * and adding one for two polylines would be a poor trade. Both series are
 * direct-labelled at their right edge, so identity never rests on colour
 * alone.
 */
import { TokenBurnBucket } from '../types';
import {
  BurnMetric,
  areaPath,
  buildPlot,
  formatBucketLabel,
  formatTokens,
  isEmptyPlot,
  linePath,
  nearestIndex,
  tickIndices,
} from '../utils/tokenBurn';

const PAD_LEFT = 60;
const PAD_RIGHT = 92;
const PAD_TOP = 18;
const PAD_BOTTOM = 28;
const GRID_LINES = 4;

interface TokenBurnChartProps {
  buckets: TokenBurnBucket[];
  metric: BurnMetric;
  height?: number;
  emptyMessage?: string;
}

export function TokenBurnChart({
  buckets,
  metric,
  height = 240,
  emptyMessage = 'Nothing recorded in this window yet.',
}: TokenBurnChartProps) {
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The SVG is laid out in user units that must equal CSS pixels, or the
  // hover cursor lands away from the point it is reporting.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, 10);
  const plotHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 10);

  const plot = useMemo(
    () => buildPlot(buckets, metric, plotWidth, plotHeight),
    [buckets, metric, plotWidth, plotHeight]
  );

  const ticks = useMemo(() => tickIndices(buckets.length), [buckets.length]);
  const empty = buckets.length === 0 || isEmptyPlot(buckets, metric);

  const onMove = useCallback((event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverIndex(nearestIndex(event.clientX - rect.left, buckets.length, plotWidth));
  }, [buckets.length, plotWidth]);

  if (empty) {
    return (
      <div className="chart-plot-wrap" ref={wrapRef}>
        <div className="chart-empty">{emptyMessage}</div>
      </div>
    );
  }

  const hovered = hoverIndex !== null ? buckets[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? plot.series[0]?.points[hoverIndex]?.x ?? 0 : 0;

  return (
    <div className="chart-plot-wrap" ref={wrapRef}>
      <svg className="chart-plot" width={width} height={height} role="img"
           aria-label={`Token burn over ${buckets.length} days`}>
        <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>
          {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
            const y = (i / GRID_LINES) * plotHeight;
            const value = plot.yMax * (1 - i / GRID_LINES);
            return (
              <g key={i}>
                <line className="chart-gridline" x1={0} y1={y} x2={plotWidth} y2={y} />
                <text className="chart-tick-label" x={-8} y={y + 4} textAnchor="end">
                  {formatTokens(value)}
                </text>
              </g>
            );
          })}

          {ticks.map(index => (
            <text key={index} className="chart-tick-label"
                  x={plot.series[0]?.points[index]?.x ?? 0}
                  y={plotHeight + 18} textAnchor="middle">
              {formatBucketLabel(buckets[index].bucket)}
            </text>
          ))}

          {plot.series.map(series => (
            <path key={`area-${series.key}`}
                  className={`burn-series-area is-${series.key}`}
                  d={areaPath(series.points, plotHeight)} />
          ))}
          {plot.series.map(series => (
            <path key={`line-${series.key}`}
                  className={`burn-series-line is-${series.key}`}
                  d={linePath(series.points)} />
          ))}

          {plot.series.map(series => {
            const last = series.points[series.points.length - 1];
            if (!last) return null;
            return (
              <text key={`label-${series.key}`} className={`burn-label is-${series.key}`}
                    x={plotWidth + 8} y={Math.min(Math.max(last.y, 10), plotHeight)}>
                {series.label}
              </text>
            );
          })}

          {hovered && (
            <line className="burn-cursor" x1={hoverX} y1={0} x2={hoverX} y2={plotHeight} />
          )}

          {/* One overlay drives hover: a 365-day window must not become 365
              elements competing for the pointer. */}
          <rect x={0} y={0} width={plotWidth} height={plotHeight} fill="transparent"
                onMouseMove={onMove} onMouseLeave={() => setHoverIndex(null)} />
        </g>
      </svg>

      {hovered && (
        <div className="burn-tooltip"
             style={{ left: Math.min(hoverX + PAD_LEFT + 12, width - 180), top: PAD_TOP }}>
          <div className="burn-tooltip-day">{formatBucketLabel(hovered.bucket)}</div>
          <div className="burn-tooltip-row">
            <span className="burn-swatch is-plugin" />
            claude-mem <strong>{formatTokens(hovered.plugin[metric])}</strong>
          </div>
          <div className="burn-tooltip-row">
            <span className="burn-swatch is-user" />
            Your sessions <strong>{formatTokens(hovered.user[metric])}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
