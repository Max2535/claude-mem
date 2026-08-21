import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Observation, Summary, UserPrompt } from '../types';

/**
 * One dot per recorded event, laid out on a lane per kind. The lanes are
 * direct-labelled, so kind is encoded twice (position + hue) and never by
 * colour alone — the palette is validated for CVD in both themes, but a reader
 * should not have to rely on it.
 */

interface Mark {
  epoch: number;
  label: string;
}

interface Lane {
  key: 'observation' | 'summary' | 'prompt';
  label: string;
  marks: Mark[];
}

const WINDOWS = [
  { id: '1h', label: '1h', ms: 60 * 60 * 1000 },
  { id: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All', ms: null as number | null },
] as const;

type WindowId = typeof WINDOWS[number]['id'];

const LANE_HEIGHT = 34;
const PAD_LEFT = 96;
const PAD_RIGHT = 16;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const DOT_R = 4;
/** Bigger than the dot so a 8px mark is still comfortable to hover. */
const HIT_R = 10;
const TICK_COUNT = 6;

function truncate(text: string | null | undefined, max = 70): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(untitled)';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function tickLabel(epoch: number, spanMs: number): string {
  const d = new Date(epoch);
  if (spanMs > 3 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface ActivityTimelineProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
}

export function ActivityTimeline({ observations, summaries, prompts }: ActivityTimelineProps) {
  const [windowId, setWindowId] = useState<WindowId>('24h');
  const [hovered, setHovered] = useState<{ x: number; y: number; lane: string; mark: Mark } | null>(null);
  const [width, setWidth] = useState(720);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The SVG is laid out in user units that must match CSS pixels for the
  // tooltip to land on the dot, so the width is measured rather than assumed.
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

  const lanes: Lane[] = useMemo(() => [
    {
      key: 'observation',
      label: 'Observations',
      marks: observations.map(o => ({ epoch: o.created_at_epoch, label: truncate(o.title ?? o.text) })),
    },
    {
      key: 'summary',
      label: 'Summaries',
      marks: summaries.map(s => ({ epoch: s.created_at_epoch, label: truncate(s.request ?? s.completed) })),
    },
    {
      key: 'prompt',
      label: 'Prompts',
      marks: prompts.map(p => ({ epoch: p.created_at_epoch, label: truncate(p.prompt_text) })),
    },
  ], [observations, summaries, prompts]);

  const allEpochs = useMemo(
    () => lanes.flatMap(l => l.marks.map(m => m.epoch)).filter(e => Number.isFinite(e)),
    [lanes]
  );

  const domain = useMemo(() => {
    if (allEpochs.length === 0) return null;
    const latest = Math.max(...allEpochs);
    const earliest = Math.min(...allEpochs);
    const selected = WINDOWS.find(w => w.id === windowId)!;
    // Anchored to the newest event rather than to now, so a viewer opened after
    // an idle stretch still shows the work instead of an empty band.
    const end = latest;
    const start = selected.ms === null ? earliest : end - selected.ms;
    // A single event, or several inside one millisecond, would collapse the
    // scale; give it a minute of room so the dot lands mid-band.
    if (end - start < 60_000) return { start: end - 30_000, end: end + 30_000 };
    return { start, end };
  }, [allEpochs, windowId]);

  const height = PAD_TOP + lanes.length * LANE_HEIGHT + PAD_BOTTOM;
  const plotWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, 80);

  const scaleX = useCallback((epoch: number): number => {
    if (!domain) return PAD_LEFT;
    const t = (epoch - domain.start) / (domain.end - domain.start);
    return PAD_LEFT + t * plotWidth;
  }, [domain, plotWidth]);

  const ticks = useMemo(() => {
    if (!domain) return [];
    const span = domain.end - domain.start;
    return Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
      const epoch = domain.start + (span * i) / TICK_COUNT;
      return { epoch, x: PAD_LEFT + (plotWidth * i) / TICK_COUNT, label: tickLabel(epoch, span) };
    });
  }, [domain, plotWidth]);

  const visibleCount = useMemo(() => {
    if (!domain) return 0;
    return lanes.reduce(
      (sum, lane) => sum + lane.marks.filter(m => m.epoch >= domain.start && m.epoch <= domain.end).length,
      0
    );
  }, [lanes, domain]);

  return (
    <section className="chart-card" aria-label="Activity timeline">
      <div className="chart-head">
        <div>
          <h2 className="chart-title">Activity</h2>
          <p className="chart-subtitle">
            {domain
              ? `${visibleCount.toLocaleString()} event${visibleCount === 1 ? '' : 's'} · ${tickLabel(domain.start, domain.end - domain.start)} – ${tickLabel(domain.end, domain.end - domain.start)}`
              : 'No activity recorded yet'}
          </p>
        </div>
        <div className="chart-range" role="group" aria-label="Time range">
          {WINDOWS.map(w => (
            <button
              key={w.id}
              type="button"
              className={`chart-range-btn ${w.id === windowId ? 'is-active' : ''}`}
              onClick={() => setWindowId(w.id)}
              aria-pressed={w.id === windowId}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-plot-wrap" ref={wrapRef}>
        {!domain ? (
          <p className="chart-empty">
            Nothing to plot yet — the timeline fills in as claude-mem records observations.
          </p>
        ) : (
          <svg
            className="chart-plot"
            width={width}
            height={height}
            role="img"
            aria-label={`Activity across ${lanes.map(l => l.label).join(', ')}`}
          >
            {ticks.map(tick => (
              <g key={tick.x}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={PAD_TOP - 8}
                  y2={height - PAD_BOTTOM + 4}
                  className="chart-gridline"
                />
                <text x={tick.x} y={height - PAD_BOTTOM + 18} className="chart-tick-label" textAnchor="middle">
                  {tick.label}
                </text>
              </g>
            ))}

            {lanes.map((lane, laneIndex) => {
              const y = PAD_TOP + laneIndex * LANE_HEIGHT + LANE_HEIGHT / 2;
              const inWindow = lane.marks.filter(m => m.epoch >= domain.start && m.epoch <= domain.end);
              return (
                <g key={lane.key}>
                  <text x={PAD_LEFT - 12} y={y + 4} className="chart-lane-label" textAnchor="end">
                    {lane.label}
                  </text>
                  <line x1={PAD_LEFT} x2={PAD_LEFT + plotWidth} y1={y} y2={y} className="chart-lane-rule" />
                  {inWindow.map((mark, i) => {
                    const x = scaleX(mark.epoch);
                    return (
                      <g key={`${mark.epoch}-${i}`}>
                        <circle
                          cx={x}
                          cy={y}
                          r={DOT_R}
                          className={`chart-dot chart-dot-${lane.key}`}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={HIT_R}
                          fill="transparent"
                          onMouseEnter={() => setHovered({ x, y, lane: lane.label, mark })}
                          onMouseLeave={() => setHovered(null)}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}

        {hovered && (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(Math.max(hovered.x, 8), Math.max(width - 8, 8))}px`,
              top: `${hovered.y}px`,
            }}
            role="status"
          >
            <div className="chart-tooltip-kind">{hovered.lane}</div>
            <div className="chart-tooltip-label">{hovered.mark.label}</div>
            <div className="chart-tooltip-time">{new Date(hovered.mark.epoch).toLocaleString()}</div>
          </div>
        )}
      </div>
    </section>
  );
}
