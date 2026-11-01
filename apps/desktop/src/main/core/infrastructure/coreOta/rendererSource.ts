import { existsSync } from 'node:fs';
import path from 'node:path';

import type { RendererTreeFile } from './manifest';

export const RENDERER_ROOT = 'dist/renderer';
const RENDERER_PREFIX = `${RENDERER_ROOT}/`;

export const isRendererPath = (treePath: string) => treePath.startsWith(RENDERER_PREFIX);

export interface RendererSource {
  resolve: (relPath: string) => string | null;
}

type TreeSourceOptions = {
  builtinDir: string;
  builtinTree: RendererTreeFile[];
  storeDir: string;
  tree: RendererTreeFile[];
};

export const dirRendererSource = (root: string): RendererSource => ({
  resolve: (relPath) => {
    const file = path.join(root, relPath);
    return existsSync(file) ? file : null;
  },
});

const toTreePath = (relPath: string) => {
  try {
    return decodeURIComponent(relPath).replaceAll('\\', '/').replace(/^\/+/, '');
  } catch {
    return null;
  }
};

export const treeRendererSource = ({
  builtinDir,
  builtinTree,
  storeDir,
  tree,
}: TreeSourceOptions): RendererSource => {
  const builtinByHash = new Map(
    builtinTree.map((file) => [file.sha256, path.join(builtinDir, file.path)]),
  );
  const hashByPath = new Map(
    tree
      .filter((file) => isRendererPath(file.path))
      .map((file) => [file.path.slice(RENDERER_PREFIX.length), file.sha256]),
  );
  return {
    resolve: (relPath) => {
      const treePath = toTreePath(relPath);
      const sha256 = treePath === null ? undefined : hashByPath.get(treePath);
      if (!sha256) return null;
      return builtinByHash.get(sha256) ?? path.join(storeDir, sha256);
    },
  };
};
