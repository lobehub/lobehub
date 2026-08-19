import { existsSync } from 'node:fs';
import path from 'node:path';

export const resolveWorkbenchHtmlPath = (root: string) => {
  const preferred = path.resolve(root, 'dist/workbench/index.workbench.html');
  if (existsSync(preferred)) return preferred;

  const fallback = path.resolve(root, 'dist/workbench/index.html');
  if (existsSync(fallback)) return fallback;

  return undefined;
};

export const requireWorkbenchHtmlPath = (root: string) => {
  const resolved = resolveWorkbenchHtmlPath(root);
  if (resolved) return resolved;

  throw new Error(
    'Workbench SPA build is required: missing dist/workbench/index.workbench.html and dist/workbench/index.html',
  );
};
