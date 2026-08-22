import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { layoutTree, LaidOutNode, TreeInput } from '../utils/tidyTree';
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
 * Leaf labels are set at 60 degrees, so a long one reaches down and to the
 * right of the dot it belongs to. Measured in the browser, a 26-character
 * label draws up to ~146px along that diagonal, which is sin(60)·146 ≈ 127px
 * of drop and cos(60)·146 ≈ 73px of reach. The earlier 118/64 were fitted to
 * a shorter sample and clipped the bottom row by a few pixels.
 */
const PAD_BOTTOM = 140;
const PAD_RIGHT_EXTRA = 78;

/**
 * The page opens expanded through the prompt tier and folds the observations
 * away: a busy day draws ~17 nodes on the bottom row instead of ~70, which is
 * the difference between labels that read and labels that overlap into a mat.
 * A click on any node with children opens or closes it.
 */
const DEFAULT_OPEN: Record<ExplorerNode['kind'], boolean> = {
  day: true,
  block: true,
  session: true,
  prompt: false,
  observation: false,
};

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
  /** The block the time stepper points at, or undefined when it has no cursor. */
  currentBlockId?: string;
  /** Set by the toolbar; the nonce makes a repeat of the same target count. */
  locate?: { nodeId: string; nonce: number; pulse: boolean } | null;
}

/** A cubic curve that leaves the parent downward and enters the child downward. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function TreeGraph({ day, observations, mode, selectedId, onSelect, currentBlockId, locate }: TreeGraphProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(entries => setPaneWidth(entries[0].contentRect.width));
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // A toggle set rather than an open set: the default differs per kind, so
  // membership has to mean "not the default for this node" to express both.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { setToggled(new Set()); }, [day, mode]);

  const tree = useMemo(() => buildHierarchy(day, observations, mode), [day, observations, mode]);

  // A deep link can name an observation inside a folded subtree; open its
  // ancestors so the node it points at is actually on the canvas.
  const forcedOpen = useMemo(() => {
    const chain = new Set<string>();
    if (selectedId === undefined) return chain;
    const walk = (node: TreeInput<ExplorerNode>, ancestors: string[]): boolean => {
      if (node.data.observationId === selectedId) {
        for (const id of ancestors) chain.add(id);
        return true;
      }
      return node.children.some(child => walk(child, [...ancestors, node.id]));
    };
    walk(tree, []);
    return chain;
  }, [tree, selectedId]);

  const isOpen = useCallback((node: TreeInput<ExplorerNode>): boolean => {
    if (forcedOpen.has(node.id)) return true;
    const fallback = DEFAULT_OPEN[node.data.kind];
    return toggled.has(node.id) ? !fallback : fallback;
  }, [toggled, forcedOpen]);

  // Prune before laying out: a folded node's descendants must not take up leaf
  // slots, or folding buys no spacing at all.
  const layout = useMemo(() => {
    const prune = (node: TreeInput<ExplorerNode>): TreeInput<ExplorerNode> => (
      node.children.length && isOpen(node)
        ? { ...node, children: node.children.map(prune) }
        : { ...node, children: [] }
    );
    return layoutTree(prune(tree));
  }, [tree, isOpen]);

  // A pruned node keeps its own id but loses its children, so the layout alone
  // cannot say whether a childless node is a real leaf or a folded branch.
  const foldedCounts = useMemo(() => {
    const map = new Map<string, number>();
    const walk = (node: TreeInput<ExplorerNode>) => {
      if (!node.children.length) return;
      if (isOpen(node)) node.children.forEach(walk);
      else map.set(node.id, node.data.count);
    };
    walk(tree);
    return map;
  }, [tree, isOpen]);

  const toggle = useCallback((id: string) => {
    setToggled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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
  // scrolled to the far left it opens on empty grid. Only on a new day or mode
  // though — re-centring on every fold would yank the canvas out from under
  // the click that caused it, so the geometry comes in through a ref.
  const rootXRef = useRef(0);
  rootXRef.current = (() => {
    const root = layout.nodes.find(n => n.depth === 0);
    return root ? offsetX + PAD_X + root.x * colGap : 0;
  })();

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !rootXRef.current) return;
    scroller.scrollLeft = rootXRef.current - scroller.clientWidth / 2;
  }, [day, mode, paneWidth]);

  // Bring a deep-linked observation into view once its ancestors have opened.
  useEffect(() => {
    const scroller = scrollRef.current;
    const target = selectedId === undefined ? undefined : positions.get(`o-${selectedId}`);
    if (!scroller || !target) return;
    scroller.scrollTo({ left: target.x - scroller.clientWidth / 2, behavior: 'smooth' });
  }, [selectedId, positions]);

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
          const folded = foldedCounts.get(node.id);
          const isLeafDot = kind === 'observation';
          const activate = isLeafDot
            ? () => onSelect(node.data.observationId!)
            : node.isLeaf && folded === undefined
              ? undefined
              : () => toggle(node.id);
          const counted = `${node.data.count} observation${node.data.count === 1 ? '' : 's'}`;
          const tip = [node.data.label, node.data.hint, counted].filter(Boolean).join(' · ');

          return (
            <g
              key={node.id}
              className={`tree-node tree-node-${kind}${isSelected ? ' is-selected' : ''}${folded === undefined ? '' : ' is-folded'}${node.id === currentBlockId ? ' is-current' : ''}`}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={activate}
              style={activate ? { cursor: 'pointer' } : undefined}
              tabIndex={activate ? 0 : undefined}
              role={activate ? 'button' : undefined}
              aria-label={activate ? node.data.label : undefined}
              aria-expanded={isLeafDot || !activate ? undefined : folded === undefined}
              onKeyDown={activate ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate();
                }
              } : undefined}
            >
              {/* A 4px dot is far too small to hit; this invisible disc is the
                  real target and keeps the drawn dot small, as designed. */}
              {activate && <circle className="tree-node-hit" r={Math.max(11, RADIUS[kind] + 4)} />}
              {/* A folded branch wears a second ring, so a closed node reads as
                  closed and not as an ordinary childless one. */}
              {folded !== undefined && <circle className="tree-node-ring" r={RADIUS[kind] + 4} />}
              {/* Outside the folded ring, so a block that is both folded and
                  current reads as both rather than as one or the other. */}
              {node.id === currentBlockId && <circle className="tree-node-current-ring" r={RADIUS[kind] + 8} />}
              {/* Locate has nothing to scroll when the drawing already fits the
                  pane, so it says "here" instead. The key remounts the circle,
                  which is what replays a one-shot animation without a timer. */}
              {locate?.pulse && locate.nodeId === node.id && (
                <circle key={`${locate.nodeId}-${locate.nonce}`} className="tree-node-pulse" r={RADIUS[kind] + 8} />
              )}
              <circle className="tree-node-dot" r={RADIUS[kind]} />
              {node.data.glyph && <text className="tree-node-glyph" dy="0.35em">{node.data.glyph}</text>}
              <title>{tip}</title>
              {folded === undefined && (kind === 'day' || kind === 'block' || kind === 'session') && (
                <text className="tree-node-label" y={RADIUS[kind] + 14}>{truncate(node.data.label, 22)}</text>
              )}
              {/* A folded node is the bottom of its column, so it takes the
                  rotated label the leaves use — hundreds of them would collide
                  on a shared baseline, and a fold can sit anywhere. */}
              {folded !== undefined && (
                <text className="tree-node-leaf-label" transform={`translate(0,${RADIUS[kind] + 10}) rotate(60)`}>
                  {`${truncate(node.data.label, 22)} (${folded})`}
                </text>
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
