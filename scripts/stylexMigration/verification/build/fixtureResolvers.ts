import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { Plugin } from 'vite';

export interface ModuleBoundary {
  importer: string;
  replacement: string;
  source: string;
}

/** Only exact, declared import edges are replaced; never blanket store/UI aliases. */
export const fixtureDataBoundary = (
  root: string,
  host: string,
  boundaries: ModuleBoundary[],
  hits: Set<string>,
): Plugin => ({
  name: 'verification-explicit-data-boundaries',
  enforce: 'pre',
  async resolveId(id, importer) {
    if (!importer) return;
    const cleanImporter = importer.split('?')[0];
    const canonicalSource = (source: string) =>
      source.startsWith('@/') ? path.join(root, 'src', source.slice(2))
        : source.startsWith('.') ? path.resolve(path.dirname(cleanImporter), source) : source;
    const boundary = boundaries.find(
      (entry) => path.resolve(root, entry.importer) === cleanImporter &&
        (entry.source === id || canonicalSource(entry.source) === canonicalSource(id)),
    );
    if (!boundary) return;
    const replacement = await realpath(path.resolve(host, boundary.replacement));
    if (!replacement.startsWith(host + path.sep)) throw new Error('FIXTURE_BOUNDARY_ESCAPE');
    hits.add(`${boundary.importer}:${boundary.source}`);
    return replacement;
  },
});

interface WorkspacePackage {
  directory: string;
  exports: Record<string, unknown>;
}

/** Resolve only explicit source exports in this snapshot, not checkout workspace links. */
export const workspaceExports = async (root: string): Promise<Plugin> => {
  const packages = new Map<string, WorkspacePackage>();
  const scan = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'package.json')) {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (typeof manifest.name !== 'string') return;
      const exports =
        typeof manifest.exports === 'string'
          ? { '.': manifest.exports }
          : (manifest.exports ?? { '.': manifest.module ?? manifest.main });
      packages.set(manifest.name, { directory, exports });
      return;
    }
    if (depth === 0) return;
    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        await scan(path.join(directory, entry.name), depth - 1);
  };
  await scan(path.join(root, 'packages'), 3);
  return {
    name: 'verification-snapshot-workspace-exports',
    enforce: 'pre',
    async resolveId(id) {
      const parts = id.split('/');
      const packageName = parts.splice(0, id.startsWith('@') ? 2 : 1).join('/');
      const workspace = packages.get(packageName);
      if (!workspace) return;
      const key = parts.length ? `./${parts.join('/')}` : '.';
      const entry = workspace.exports[key];
      // Conditional and wildcard exports need an explicit adapter; do not guess.
      if (typeof entry !== 'string' || !entry.startsWith('./'))
        throw new Error(`WORKSPACE_EXPORT_UNSUPPORTED:${id}`);
      const resolved = await realpath(path.join(workspace.directory, entry));
      if (!resolved.startsWith(workspace.directory + path.sep))
        throw new Error(`WORKSPACE_EXPORT_ESCAPE:${id}`);
      return resolved;
    },
  };
};
