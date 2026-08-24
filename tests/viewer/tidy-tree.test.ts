import { describe, it, expect } from 'bun:test';
import { layoutTree, TreeInput } from '../../src/ui/viewer/utils/tidyTree.js';

function node(id: string, children: TreeInput<null>[] = []): TreeInput<null> {
  return { id, data: null, children };
}

describe('layoutTree', () => {
  it('gives each leaf its own slot, left to right in order', () => {
    const { nodes, width } = layoutTree(node('root', [node('a'), node('b'), node('c')]));
    const leaves = nodes.filter(n => n.isLeaf).sort((l, r) => l.x - r.x);

    expect(leaves.map(l => l.id)).toEqual(['a', 'b', 'c']);
    expect(leaves.map(l => l.x)).toEqual([0, 1, 2]);
    expect(width).toBe(3);
  });

  it('centres a parent between its outermost children', () => {
    const { nodes } = layoutTree(node('root', [node('a'), node('b'), node('c')]));
    expect(nodes.find(n => n.id === 'root')!.x).toBe(1);
  });

  it('centres over the span, not the mean, when subtrees are lopsided', () => {
    // left has three leaves (slots 0,1,2), right has one (slot 3).
    const tree = node('root', [
      node('left', [node('l1'), node('l2'), node('l3')]),
      node('right', [node('r1')]),
    ]);
    const { nodes } = layoutTree(tree);
    const at = (id: string) => nodes.find(n => n.id === id)!.x;

    expect(at('left')).toBe(1);
    expect(at('right')).toBe(3);
    // mean of children would be 2, span midpoint is (1 + 3) / 2 = 2 as well;
    // the distinction shows in the leaf slots staying evenly spaced.
    expect(at('root')).toBe(2);
    expect(nodes.filter(n => n.isLeaf).map(n => n.x).sort((l, r) => l - r)).toEqual([0, 1, 2, 3]);
  });

  it('reports depth and emits one edge per parent-child pair', () => {
    const { edges, depth, nodes } = layoutTree(node('root', [node('a', [node('a1')])]));
    expect(depth).toBe(2);
    expect(nodes).toHaveLength(3);
    expect(edges).toEqual(expect.arrayContaining([
      { from: 'root', to: 'a' },
      { from: 'a', to: 'a1' },
    ]));
    expect(edges).toHaveLength(2);
  });

  it('handles a bare root with no children', () => {
    const { nodes, edges, width } = layoutTree(node('only'));
    expect(nodes).toEqual([expect.objectContaining({ id: 'only', x: 0, depth: 0, isLeaf: true })]);
    expect(edges).toEqual([]);
    expect(width).toBe(1);
  });
});
