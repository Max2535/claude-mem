import React, { useMemo, useRef, useEffect, useState } from 'react';
import { layoutTree, LaidOutNode } from '../utils/tidyTree';
import { ExplorerNode, buildHierarchy, GroupMode } from '../utils/explorerHierarchy';
import { ExplorerDayObservation } from '../types';

/**
 * Leaf spacing is fitted to the pane so a day's whole tree is visible at once
 * where it can be. Below MIN_COL_GAP the dots start touching, so past that the
 * canvas scrolls instead of squeezing further.
 */
const MIN_COL_GAP = 13;
const MAX_COL_GAP = 34;
const ROW_GAP = 106;     // vertical pixels per depth level
const PAD_X = 60;
const PAD_TOP = 42;
/**
 * Leaf labels are set at 60 degrees, so a 26-character one reaches roughly
 * 100px below the baseline and 60px to its right. Both paddings account for
 * that; without them the last column's label is clipped by the canvas edge.
 */
const PAD_BOTTOM = 118;
const PAD_RIGHT_EXTRA = 64;

const RADIUS: Record<ExplorerNode['kind'], number> = {
  day: 15,
  block: 12,
  session: 9,
  prompt: 8,
  observation: 4,
};

interface TreeGraphProps {
  day: string;
  observations: ExplorerDayObservation[];
  mode: GroupMode;
  selectedId?: number;
  onSelect: (observationId: number) => void;
  /** Set by the toolbar's Locate button; the nonce makes repeat clicks count. */
  locate?: { nodeId: string; nonce: number } | null;
}

/** A cubic curve that leaves the parent downward and enters the child downward. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function TreeGraph({ day, observations, mode, selectedId, onSelect, locate }: TreeGraphProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(entries => setPaneWidth(entries[0].contentRect.width));
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutTree(buildHierarchy(day, observations, mode)),
    [day, observations, mode]
  );

  const colGap = useMemo(() => {
    const slots = Math.max(layout.width - 1, 1);
    const available = Math.max(paneWidth - PAD_X * 2 - PAD_RIGHT_EXTRA, 0);
    if (!available) return MAX_COL_GAP;
    return Math.min(MAX_COL_GAP, Math.max(MIN_COL_GAP, available / slots));
  }, [layout.width, paneWidth]);

  // A day with few observations draws narrower than the pane; centre it rather
  // than leaving the tree hugging the left edge on a wide empty grid.
  const naturalWidth = PAD_X * 2 + PAD_RIGHT_EXTRA + Math.max(layout.width - 1, 0) * colGap;
  const offsetX = Math.max(0, (paneWidth - naturalWidth) / 2);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; node: LaidOutNode<ExplorerNode> }>();
    for (const node of layout.nodes) {
      map.set(node.id, {
        x: offsetX + PAD_X + node.x * colGap,
        y: PAD_TOP + node.depth * ROW_GAP,
        node,
      });
    }
    return map;
  }, [layout, colGap, offsetX]);

  const width = Math.max(naturalWidth, paneWidth);
  const height = PAD_TOP + layout.depth * ROW_GAP + PAD_BOTTOM;

  // Arrive centred on the root: the drawing is usually wider than the pane, and
  // scrolled to the far left it opens on empty grid.
  useEffect(() => {
    const scroller = scrollRef.current;
    const root = layout.nodes.find(n => n.depth === 0);
    if (!scroller || !root) return;
    scroller.scrollLeft = offsetX + PAD_X + root.x * colGap - scroller.clientWidth / 2;
  }, [day, mode, layout, colGap, offsetX]);

  useEffect(() => {
    const target = locate ? positions.get(locate.nodeId) : undefined;
    const scroller = scrollRef.current;
    if (!target || !scroller) return;
    scroller.scrollTo({ left: target.x - scroller.clientWidth / 2, behavior: 'smooth' });
  }, [locate, positions]);

  if (observations.length === 0) {
    return <div className="tree-graph-empty">Nothing recorded on this day.</div>;
  }

  return (
    <div className="tree-graph" ref={scrollRef}>
      <svg width={width} height={height} role="img" aria-label={`Activity tree for ${day}`}>
        <g className="tree-edges">
          {layout.edges.map(edge => {
            const from = positions.get(edge.from)!;
            const to = positions.get(edge.to)!;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={edgePath(from.x, from.y + RADIUS[from.node.data.kind], to.x, to.y - RADIUS[to.node.data.kind])}
              />
            );
          })}
        </g>

        {layout.nodes.map(node => {
          const pos = positions.get(node.id)!;
          const kind = node.data.kind;
          const isSelected = kind === 'observation' && node.data.observationId === selectedId;
          const clickable = kind === 'observation';

          return (
            <g
              key={node.id}
              className={`tree-node tree-node-${kind}${isSelected ? ' is-selected' : ''}`}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={clickable ? () => onSelect(node.data.observationId!) : undefined}
              style={clickable ? { cursor: 'pointer' } : undefined}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? 'button' : undefined}
              aria-label={clickable ? node.data.label : undefined}
              onKeyDown={clickable ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(node.data.observationId!);
                }
              } : undefined}
            >
              {/* A 4px dot is far too small to hit; this invisible disc is the
                  real target and keeps the drawn dot small, as designed. */}
              {clickable && <circle className="tree-node-hit" r={11} />}
              <circle className="tree-node-dot" r={RADIUS[kind]} />
              {node.data.glyph && <text className="tree-node-glyph" dy="0.35em">{node.data.glyph}</text>}
              <title>{`${node.data.label} · ${node.data.count} observation${node.data.count === 1 ? '' : 's'}`}</title>
              {(kind === 'day' || kind === 'block' || kind === 'session') && (
                <text className="tree-node-label" y={RADIUS[kind] + 14}>{truncate(node.data.label, 22)}</text>
              )}
              {kind === 'observation' && (
                <text className="tree-node-leaf-label" transform={`translate(0,${RADIUS[kind] + 8}) rotate(60)`}>
                  {truncate(node.data.label, 26)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
