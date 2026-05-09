import type { ExplorerTreeNode } from '../types';
import { buildSegment } from './path';

export interface NormalizedTree<TData> {
  idByPath: Map<string, string>;
  nodeById: Map<string, ExplorerTreeNode<TData>>;
  parentIdById: Map<string, string | null>;
  pathById: Map<string, string>;
  paths: string[];
}

const dedupeName = (taken: Set<string>, baseName: string, isFolder: boolean): string => {
  const segment = buildSegment(baseName, isFolder);
  if (!taken.has(segment)) {
    taken.add(segment);
    return baseName;
  }
  // split name / ext for nicer suffixes on files
  const dotIndex = isFolder ? -1 : baseName.lastIndexOf('.');
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : '';
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    const seg = buildSegment(candidate, isFolder);
    if (!taken.has(seg)) {
      taken.add(seg);
      return candidate;
    }
  }
  const fallback = `${stem}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  taken.add(buildSegment(fallback, isFolder));
  return fallback;
};

export const normalizeTree = <TData>(nodes: ExplorerTreeNode<TData>[]): NormalizedTree<TData> => {
  const pathById = new Map<string, string>();
  const idByPath = new Map<string, string>();
  const nodeById = new Map<string, ExplorerTreeNode<TData>>();
  const parentIdById = new Map<string, string | null>();
  const paths: string[] = [];

  const hasChildrenTree = nodes.some((n) => Array.isArray(n.children));
  if (hasChildrenTree) {
    const walk = (
      siblings: ExplorerTreeNode<TData>[],
      parentPath: string,
      parentId: string | null,
    ) => {
      const taken = new Set<string>();
      for (const node of siblings) {
        const uniqueName = dedupeName(taken, node.name, !!node.isFolder);
        const segment = buildSegment(uniqueName, !!node.isFolder);
        const fullPath = parentPath + segment;
        pathById.set(node.id, fullPath);
        idByPath.set(fullPath, node.id);
        nodeById.set(node.id, node);
        parentIdById.set(node.id, parentId);
        paths.push(fullPath);
        if (node.children?.length) {
          const nextParent = node.isFolder ? fullPath : parentPath;
          walk(node.children, nextParent, node.id);
        }
      }
    };
    walk(nodes, '', null);
    return { idByPath, nodeById, parentIdById, pathById, paths };
  }

  // flat form (parentId)
  const byParent = new Map<string | null, ExplorerTreeNode<TData>[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(node);
    else byParent.set(key, [node]);
  }

  const walkFlat = (parentId: string | null, parentPath: string) => {
    const siblings = byParent.get(parentId);
    if (!siblings) return;
    const taken = new Set<string>();
    for (const node of siblings) {
      const uniqueName = dedupeName(taken, node.name, !!node.isFolder);
      const segment = buildSegment(uniqueName, !!node.isFolder);
      const fullPath = parentPath + segment;
      pathById.set(node.id, fullPath);
      idByPath.set(fullPath, node.id);
      nodeById.set(node.id, node);
      parentIdById.set(node.id, parentId);
      paths.push(fullPath);
      if (node.isFolder) walkFlat(node.id, fullPath);
    }
  };
  walkFlat(null, '');
  return { idByPath, nodeById, parentIdById, pathById, paths };
};

export const remapIdsToPaths = (
  ids: readonly string[] | undefined,
  pathById: Map<string, string>,
): string[] => {
  if (!ids?.length) return [];
  const out: string[] = [];
  for (const id of ids) {
    const p = pathById.get(id);
    if (p) out.push(p);
  }
  return out;
};

export const remapPathsToIds = (
  paths: readonly string[] | undefined,
  idByPath: Map<string, string>,
): string[] => {
  if (!paths?.length) return [];
  const out: string[] = [];
  for (const p of paths) {
    const id = idByPath.get(p);
    if (id) out.push(id);
  }
  return out;
};

export const arrayEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

export const isDescendantOf = (
  nodeId: string,
  possibleAncestorId: string,
  parentIdById: Map<string, string | null>,
): boolean => {
  let cursor = parentIdById.get(nodeId) ?? null;
  while (cursor) {
    if (cursor === possibleAncestorId) return true;
    cursor = parentIdById.get(cursor) ?? null;
  }
  return false;
};
