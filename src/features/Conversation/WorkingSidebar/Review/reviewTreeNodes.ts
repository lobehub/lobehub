import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';

import type { ExplorerTreeNode } from '@/features/ExplorerTree';

/** Stable per-file diff key — shared by the diff list (scroll anchor) and the
 * tree-nav selection so clicking a tree leaf maps back to its patch. */
export const itemKey = (groupPath: string, entry: { filePath: string; status: string }): string =>
  `${groupPath}|${entry.status}:${entry.filePath}`;

export interface ReviewTreeData {
  /** itemKey of the owning patch — what the diff list scrolls to. */
  key: string;
}

export interface ReviewTreeGroup {
  absolutePath: string;
  name: string;
  patches: GitWorkingTreePatch[];
}

// Node ids are prefixed with the owning repo path so file paths that repeat
// across submodule groups never collide. NUL can't appear in a real path.
const SEP = '\u0000';

/**
 * Fold the flat per-repo patch lists into `ExplorerTree` nodes (files + the
 * chain of containing directories), so the Review nav rail renders with the
 * exact same folder / colored file-type icons as the Files tab. When there are
 * submodule groups, each group gets a top-level folder holding its files.
 */
export const buildReviewTreeNodes = (
  groups: ReviewTreeGroup[],
  showGroupHeaders: boolean,
): ExplorerTreeNode<ReviewTreeData>[] => {
  const nodes: ExplorerTreeNode<ReviewTreeData>[] = [];
  for (const group of groups) {
    if (group.patches.length === 0) continue;
    const gp = group.absolutePath;
    const rootId = showGroupHeaders ? `${gp}${SEP}` : null;
    if (rootId) nodes.push({ id: rootId, isFolder: true, name: group.name, parentId: null });

    const seenDir = new Set<string>();
    for (const patch of group.patches) {
      const segments = patch.filePath.split('/');
      // Materialise the directory chain once per unique dir.
      for (let i = 1; i < segments.length; i++) {
        const dirRel = `${segments.slice(0, i).join('/')}/`;
        const dirId = `${gp}${SEP}${dirRel}`;
        if (seenDir.has(dirId)) continue;
        seenDir.add(dirId);
        const parentId = i > 1 ? `${gp}${SEP}${segments.slice(0, i - 1).join('/')}/` : rootId;
        nodes.push({ id: dirId, isFolder: true, name: segments[i - 1], parentId });
      }
      const fileParent =
        segments.length > 1 ? `${gp}${SEP}${segments.slice(0, -1).join('/')}/` : rootId;
      nodes.push({
        data: { key: itemKey(gp, patch) },
        id: `${gp}${SEP}${patch.filePath}`,
        isFolder: false,
        name: segments.at(-1) ?? patch.filePath,
        parentId: fileParent,
      });
    }
  }
  return nodes;
};
