import type { FileTreeSortComparator, FileTreeSortEntry } from '@pierre/trees';

import type { ExplorerTreeNode, ExplorerTreeNodeComparator } from '../types';
import type { NormalizedTree } from './normalize';

const compareFallback = (left: FileTreeSortEntry, right: FileTreeSortEntry): number => {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.basename.localeCompare(right.basename);
};

// The tree path of the ancestor (or the entry itself) at `depthIndex`.
const pathAt = (entry: FileTreeSortEntry, depthIndex: number): string => {
  const isLast = depthIndex === entry.segments.length - 1;
  const joined = entry.segments.slice(0, depthIndex + 1).join('/');
  return !isLast || entry.isDirectory ? `${joined}/` : joined;
};

/**
 * Adapts a node comparator to @pierre/trees. The tree calls it on sibling rows
 * when it inserts one, but on arbitrary full paths when it builds the store
 * from a path list, so two paths are ordered by the first ancestors where they
 * diverge (a parent always comes before its own descendants).
 */
export const createPathComparator =
  <TData>(
    getTree: () => NormalizedTree<TData>,
    getCompare: () => ExplorerTreeNodeComparator<TData> | undefined,
  ): FileTreeSortComparator =>
  (left, right) => {
    const shared = Math.min(left.segments.length, right.segments.length);
    let index = 0;
    while (index < shared && left.segments[index] === right.segments[index]) index += 1;
    if (index === left.segments.length && index === right.segments.length) return 0;
    if (index === left.segments.length) return -1;
    if (index === right.segments.length) return 1;

    const compare = getCompare();
    if (!compare) return compareFallback(left, right);

    const tree = getTree();
    const leftNode = tree.nodeById.get(tree.idByPath.get(pathAt(left, index)) ?? '');
    const rightNode = tree.nodeById.get(tree.idByPath.get(pathAt(right, index)) ?? '');
    // A row the tree holds but the nodes don't (an optimistic create).
    if (!leftNode || !rightNode) return compareFallback(left, right);

    return (
      compare(leftNode, rightNode) ||
      left.segments[index].localeCompare(right.segments[index]) ||
      (left.segments[index] < right.segments[index] ? -1 : 1)
    );
  };

/**
 * The sibling order `compare` produces, as one string. Equal signatures mean
 * the tree is already drawn in this order and needs no re-sort.
 */
export const buildSortSignature = <TData>(
  tree: NormalizedTree<TData>,
  compare: ExplorerTreeNodeComparator<TData> | undefined,
): string => {
  if (!compare) return '';
  const byParent = new Map<string | null, ExplorerTreeNode<TData>[]>();
  for (const [id, node] of tree.nodeById) {
    const parentId = tree.parentIdById.get(id) ?? null;
    const siblings = byParent.get(parentId);
    if (siblings) siblings.push(node);
    else byParent.set(parentId, [node]);
  }
  const groups: string[] = [];
  for (const [parentId, siblings] of byParent) {
    const ordered = siblings.slice().sort(compare);
    groups.push(`${parentId ?? ''}:${ordered.map((node) => node.id).join(',')}`);
  }
  return groups.sort().join('\n');
};
