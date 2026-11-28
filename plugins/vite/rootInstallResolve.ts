import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

const isBareSpecifier = (source: string) =>
  !source.startsWith('.') &&
  !source.startsWith('/') &&
  !source.startsWith('\0') &&
  !/^[a-z][\w+.-]*:/i.test(source);

const packageNameOf = (source: string) => {
  const segments = source.split('/');
  if (!source.startsWith('@')) return segments[0];
  return segments.length > 1 ? `${segments[0]}/${segments[1]}` : undefined;
};

const isInside = (child: string, parent: string) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Resolve bare imports of workspace source files against the root install during dev.
 *
 * The desktop renderer serves the root SPA, but its graph also holds source files under
 * nested install trees: `apps/desktop/src/overlay` resolves through `apps/desktop/node_modules`,
 * and the standalone `apps/desktop` install relinks `packages/*\/node_modules` into its own
 * frozen store. Vite's dep optimizer keys pre-bundled deps by bare specifier, so whichever tree
 * it meets first supplies that package for every source importer. A stale desktop copy then
 * breaks root code, for example `lucide-react` without `LayoutGridPlus`.
 *
 * This plugin sends such imports to the root install whenever the root provides the package,
 * so the dev graph resolves each package from the root tree. Imports from `node_modules` keep
 * their own resolution, so nested dependencies still get the versions they pinned.
 */
export function viteRootInstallResolve({ rootDir }: { rootDir: string }): Plugin {
  const root = path.resolve(rootDir);
  const rootImporter = path.join(root, 'package.json');
  const nestedTreeCache = new Map<string, boolean>();
  const rootPackageCache = new Map<string, boolean>();

  const isUnderNestedInstallTree = (directory: string): boolean => {
    const cached = nestedTreeCache.get(directory);
    if (cached !== undefined) return cached;

    const nested =
      isInside(directory, root) &&
      (existsSync(path.join(directory, 'node_modules')) ||
        isUnderNestedInstallTree(path.dirname(directory)));
    nestedTreeCache.set(directory, nested);
    return nested;
  };

  const rootProvides = (packageName: string) => {
    let provided = rootPackageCache.get(packageName);
    if (provided === undefined) {
      provided = existsSync(path.join(root, 'node_modules', packageName, 'package.json'));
      rootPackageCache.set(packageName, provided);
    }
    return provided;
  };

  return {
    apply: 'serve',
    enforce: 'pre',
    name: 'vite-root-install-resolve',
    async resolveId(source, importer, options) {
      if (!importer || !isBareSpecifier(source)) return null;

      const importerPath = importer.split('?')[0];
      if (!path.isAbsolute(importerPath)) return null;
      if (importerPath.replaceAll('\\', '/').includes('/node_modules/')) return null;
      if (!isUnderNestedInstallTree(path.dirname(importerPath))) return null;

      const packageName = packageNameOf(source);
      if (!packageName || !rootProvides(packageName)) return null;

      return this.resolve(source, rootImporter, { ...options, skipSelf: true });
    },
  };
}
