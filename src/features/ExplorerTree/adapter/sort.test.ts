import type { FileTreeSortEntry } from '@pierre/trees';
import { describe, expect, it } from 'vitest';

import type { ExplorerTreeNode, ExplorerTreeNodeComparator } from '../types';
import { normalizeTree } from './normalize';
import { buildSortSignature, createPathComparator } from './sort';

const nodes: ExplorerTreeNode<number>[] = [
  { data: 2, id: 'docs', isFolder: true, name: 'docs', parentId: null },
  { data: 1, id: 'b', name: 'b.md', parentId: null },
  { data: 1, id: 'x', name: 'x.md', parentId: 'docs' },
];
const tree = normalizeTree(nodes);
const byData: ExplorerTreeNodeComparator<number> = (a, b) => a.data! - b.data!;

const entry = (path: string): FileTreeSortEntry => {
  const isDirectory = path.endsWith('/');
  const segments = (isDirectory ? path.slice(0, -1) : path).split('/');
  return { basename: segments.at(-1)!, depth: segments.length, isDirectory, path, segments };
};

describe('createPathComparator', () => {
  const compare = createPathComparator(
    () => tree,
    () => byData,
  );

  it('orders full paths by the ancestors where they diverge', () => {
    expect(compare(entry('docs/x.md'), entry('b.md'))).toBeGreaterThan(0);
    expect(compare(entry('b.md'), entry('docs/'))).toBeLessThan(0);
  });

  it('puts a parent before its descendants', () => {
    expect(compare(entry('docs/'), entry('docs/x.md'))).toBeLessThan(0);
    expect(compare(entry('docs/x.md'), entry('docs/'))).toBeGreaterThan(0);
  });

  it('falls back to folders first for rows the nodes do not know', () => {
    expect(compare(entry('zzz.md'), entry('docs/'))).toBeGreaterThan(0);
  });
});

describe('buildSortSignature', () => {
  it('changes only when the sibling order changes', () => {
    const signature = buildSortSignature(tree, byData);
    expect(buildSortSignature(normalizeTree([...nodes].reverse()), byData)).toBe(signature);
    expect(buildSortSignature(tree, (a, b) => byData(b, a))).not.toBe(signature);
    expect(buildSortSignature(tree, undefined)).toBe('');
  });
});
