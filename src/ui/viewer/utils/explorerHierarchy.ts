import { ExplorerDayObservation } from '../types';
import { TreeInput } from './tidyTree';

/** A gap longer than this starts a new time block, matching how work actually clusters. */
export const BLOCK_GAP_MS = 30 * 60 * 1000;

export type GroupMode = 'time' | 'app';

export type NodeKind = 'day' | 'block' | 'session' | 'prompt' | 'observation';

export interface ExplorerNode {
  kind: NodeKind;
  label: string;
  /** Short glyph drawn inside the circle; empty for the leaf dots. */
  glyph: string;
  count: number;
  /** Secondary text for the tooltip; set when a merge folded two labels into one. */
  hint?: string;
  firstAt: number;
  lastAt: number;
  /** Set only on leaves, so a click can open the observation. */
  observationId?: number;
}

function timeLabel(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function rangeLabel(first: number, last: number): string {
  return `${timeLabel(first)} – ${timeLabel(last)}`;
}

function glyphFor(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed[0].toUpperCase() : '·';
}

function span(rows: ExplorerDayObservation[]): { firstAt: number; lastAt: number } {
  return { firstAt: rows[0].createdAt, lastAt: rows[rows.length - 1].createdAt };
}

/** Rows arrive ordered by time, so a single pass finds the blocks. */
export function splitIntoBlocks(rows: ExplorerDayObservation[]): ExplorerDayObservation[][] {
  const blocks: ExplorerDayObservation[][] = [];
  for (const row of rows) {
    const current = blocks[blocks.length - 1];
    if (!current || row.createdAt - current[current.length - 1].createdAt > BLOCK_GAP_MS) {
      blocks.push([row]);
    } else {
      current.push(row);
    }
  }
  return blocks;
}

function groupBy<T>(rows: T[], key: (row: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row); else map.set(k, [row]);
  }
  return [...map.entries()];
}

function observationNodes(rows: ExplorerDayObservation[]): TreeInput<ExplorerNode>[] {
  return rows.map(row => ({
    id: `o-${row.id}`,
    data: {
      kind: 'observation' as const,
      label: row.title || row.subtitle || `#${row.id}`,
      glyph: '',
      count: 1,
      firstAt: row.createdAt,
      lastAt: row.createdAt,
      observationId: row.id,
    },
    children: [],
  }));
}

function promptNodes(rows: ExplorerDayObservation[], keyPrefix: string): TreeInput<ExplorerNode>[] {
  return groupBy(rows, row => String(row.promptNumber ?? -1)).map(([promptNumber, promptRows]) => ({
    id: `${keyPrefix}-p${promptNumber}`,
    data: {
      kind: 'prompt' as const,
      label: promptNumber === '-1' ? 'no prompt' : `prompt ${promptNumber}`,
      glyph: promptNumber === '-1' ? '·' : promptNumber,
      count: promptRows.length,
      ...span(promptRows),
    },
    children: observationNodes(promptRows),
  }));
}

function sessionNodes(rows: ExplorerDayObservation[], keyPrefix: string): TreeInput<ExplorerNode>[] {
  return groupBy(rows, row => row.contentSessionId).map(([contentSessionId, sessionRows]) => ({
    id: `${keyPrefix}-s-${contentSessionId}`,
    data: {
      kind: 'session' as const,
      label: sessionRows[0].title || `Session ${contentSessionId.slice(0, 6)}`,
      glyph: glyphFor(sessionRows[0].title ?? 'S'),
      count: sessionRows.length,
      ...span(sessionRows),
    },
    children: promptNodes(sessionRows, `${keyPrefix}-s-${contentSessionId}`),
  }));
}

/**
 * A block almost always holds exactly one session, and a tier that never
 * branches costs a row of height and a hop of reading for nothing. Merge the
 * two into one node rather than dropping either label: the block keeps its id
 * (Locate addresses it by that exact string) and takes the session's title,
 * with the time range moved to the tooltip.
 */
function mergeLoneSession(block: TreeInput<ExplorerNode>, mode: GroupMode): TreeInput<ExplorerNode> {
  if (block.children.length !== 1) return block;
  const session = block.children[0];
  // By time the session title is the more informative half; by project the
  // project name is what the mode exists to show, so it keeps the label.
  const [label, hint] = mode === 'time'
    ? [session.data.label, block.data.label]
    : [block.data.label, session.data.label];
  return {
    id: block.id,
    data: { ...block.data, label, glyph: session.data.glyph, hint },
    children: session.children,
  };
}

/**
 * By time the second level is a block of contiguous activity; by app it is the
 * project. Everything below that level is the same either way, so the two modes
 * are one shape with a different second tier rather than two layouts.
 */
export function buildHierarchy(
  day: string,
  rows: ExplorerDayObservation[],
  mode: GroupMode
): TreeInput<ExplorerNode> {
  const root: TreeInput<ExplorerNode> = {
    id: `day-${day}`,
    data: {
      kind: 'day',
      label: day,
      glyph: '',
      count: rows.length,
      firstAt: rows.length ? rows[0].createdAt : 0,
      lastAt: rows.length ? rows[rows.length - 1].createdAt : 0,
    },
    children: [],
  };

  if (rows.length === 0) return root;

  if (mode === 'time') {
    root.children = splitIntoBlocks(rows).map((blockRows, index) => ({
      id: `day-${day}-b${index}`,
      data: {
        kind: 'block' as const,
        label: rangeLabel(blockRows[0].createdAt, blockRows[blockRows.length - 1].createdAt),
        glyph: '',
        count: blockRows.length,
        ...span(blockRows),
      },
      children: sessionNodes(blockRows, `day-${day}-b${index}`),
    })).map(block => mergeLoneSession(block, mode));
  } else {
    root.children = groupBy(rows, row => row.project).map(([project, projectRows]) => ({
      id: `day-${day}-a-${project}`,
      data: {
        kind: 'block' as const,
        label: project,
        glyph: '',
        count: projectRows.length,
        ...span(projectRows),
      },
      children: sessionNodes(projectRows, `day-${day}-a-${project}`),
    })).map(block => mergeLoneSession(block, mode));
  }

  return root;
}
