/**
 * Reingold-Tilford tidy tree layout, top-down.
 *
 * Written out rather than pulling in d3-hierarchy: the viewer ships as one
 * self-contained bundle and this is the only layout it needs. The algorithm is
 * the classic two-pass one — assign each leaf the next free slot, put every
 * parent at the midpoint of its children — which is enough for a strictly
 * layered tree where no subtree needs to be pushed sideways past a sibling.
 */

export interface TreeInput<T> {
  id: string;
  data: T;
  children: TreeInput<T>[];
}

export interface LaidOutNode<T> {
  id: string;
  data: T;
  depth: number;
  /** Column position in leaf units; multiply by a gap to get pixels. */
  x: number;
  parentId: string | null;
  isLeaf: boolean;
}

export interface TreeLayout<T> {
  nodes: LaidOutNode<T>[];
  edges: { from: string; to: string }[];
  /** Number of leaf slots used — the natural width of the drawing. */
  width: number;
  depth: number;
}

export function layoutTree<T>(root: TreeInput<T>): TreeLayout<T> {
  const nodes: LaidOutNode<T>[] = [];
  const edges: { from: string; to: string }[] = [];
  let nextLeafSlot = 0;
  let maxDepth = 0;

  const walk = (node: TreeInput<T>, depth: number, parentId: string | null): number => {
    maxDepth = Math.max(maxDepth, depth);

    let x: number;
    if (node.children.length === 0) {
      x = nextLeafSlot;
      nextLeafSlot += 1;
    } else {
      const childXs = node.children.map(child => walk(child, depth + 1, node.id));
      // Centre over the span rather than the mean, so a parent with one deep
      // child and one shallow one still sits between them.
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }

    nodes.push({ id: node.id, data: node.data, depth, x, parentId, isLeaf: node.children.length === 0 });
    if (parentId !== null) edges.push({ from: parentId, to: node.id });
    return x;
  };

  walk(root, 0, null);

  return { nodes, edges, width: Math.max(nextLeafSlot, 1), depth: maxDepth };
}
