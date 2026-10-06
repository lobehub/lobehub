import type { TreeItem } from '@/store/tree';

export interface VisibleNode {
  item: TreeItem;
  key: string;
  level: number;
  parentKey: string;
}

/**
 * Flattens the expanded tree into the rows the virtual list renders, depth
 * first from the root.
 *
 * A node id renders at most once. `children` is a per-folder cache that the
 * Explorer reconciles independently of the tree's own optimistic moves, so the
 * same row can briefly sit under two folders while a move settles. Two rows
 * sharing one React key make the virtual list paint them on top of each
 * other, so the first occurrence wins and the rest are skipped until the
 * caches agree again.
 */
export const buildVisibleNodes = (
  children: Record<string, TreeItem[]>,
  expanded: Record<string, boolean>,
): VisibleNode[] => {
  const result: VisibleNode[] = [];
  const seen = new Set<string>();

  const walk = (parentKey: string, level: number) => {
    for (const node of children[parentKey] ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);

      result.push({ item: node, key: node.id, level, parentKey });
      if (node.isFolder && expanded[node.id]) {
        walk(node.id, level + 1);
      }
    }
  };

  walk('', 0);
  return result;
};
