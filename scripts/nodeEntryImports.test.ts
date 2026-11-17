/**
 * @vitest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

/**
 * Scripts that some launchers start with bare `node` (native type stripping) instead of `tsx`.
 *
 * `tsx`, Vitest and TypeScript's `bundler` resolution all map a `./foo.mjs` specifier to `foo.mts`,
 * so a wrong extension passes lint, type-check and the OSS `dev` script, yet bare `node` fails with
 * ERR_MODULE_NOT_FOUND (see #23220). Add a script here when a launcher starts it with bare `node`.
 */
const NODE_ENTRY_SCRIPTS = [
  'apps/desktop/scripts/desktopLogs.mts',
  'scripts/checkConsoleLog.mts',
  'scripts/devStartupSequence.mts',
];

const LOCAL_MODULE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts']);

/**
 * Walks the relative import graph from `entry` and lists every specifier bare `node` cannot load:
 * the specifier must name a file that exists on disk, extension included.
 */
const findUnresolvedImports = (entry: string) => {
  const unresolved: string[] = [];
  const visited = new Set<string>();
  const pending = [path.resolve(repoRoot, entry)];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);

    for (const { fileName: specifier } of importedFiles) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;

      const target = path.resolve(path.dirname(file), specifier);
      if (!existsSync(target)) {
        unresolved.push(`${path.relative(repoRoot, file)}: '${specifier}'`);
        continue;
      }
      if (LOCAL_MODULE_EXTENSIONS.has(path.extname(target))) pending.push(target);
    }
  }

  return unresolved;
};

describe('bare-node entry scripts', () => {
  it.each(NODE_ENTRY_SCRIPTS)('%s imports only files that exist on disk', (entry) => {
    expect(findUnresolvedImports(entry)).toEqual([]);
  });
});
