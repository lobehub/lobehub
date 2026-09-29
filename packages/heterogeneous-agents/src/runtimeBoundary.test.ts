import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import BROWSER_ENTRIES from '../browser-entries.json';
import pkg from '../package.json';

/**
 * The package splits by runtime at its subpath entries. `browser-entries.json`
 * lists the entries the web app may import values from; every other entry is
 * Node-only (spawn, rpc, quota-sampler, ...) and may freely use `node:*`,
 * `Buffer` or `process`. The root ESLint config reads the same list to stop
 * browser code from value-importing a Node-only entry, and this test stops a
 * browser entry from reaching Node code inside the package.
 *
 * Regression: an adapter re-exported by the root pulled in a `node:fs` reader,
 * Vite's externalized stub threw on first access, and the SPA rendered blank.
 */

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const NODE_GLOBAL = /\b(?:Buffer|__dirname|__filename)\b|\brequire\s*\(|\bprocess\.(?!env\b)/;

const FROM_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^import\s*['"]([^'"]+)['"]/gm;

const exportTargets = pkg.exports as Record<string, string>;
const entryFile = (entry: string) => path.join(PACKAGE_ROOT, exportTargets[entry]);

/** Directories owned by Node-only entries; a browser entry must not reach into them. */
const NODE_ONLY_DIRS = [
  ...new Set(
    Object.keys(exportTargets)
      .filter((entry) => !BROWSER_ENTRIES.includes(entry))
      .map((entry) => path.dirname(entryFile(entry))),
  ),
].filter((dir) => !BROWSER_ENTRIES.some((entry) => path.dirname(entryFile(entry)) === dir));

const stripComments = (source: string) =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

/**
 * Value (non type-only) module specifiers of a file's static imports and
 * re-exports. Dynamic `import()` is skipped on purpose: it loads on call, so
 * it cannot break the page just by being bundled.
 */
const staticValueImports = (source: string): string[] => {
  const text = `\n${source}`;
  const specifiers: string[] = [];
  for (const match of text.matchAll(FROM_SPECIFIER)) {
    const start = Math.max(
      text.lastIndexOf('\nimport ', match.index),
      text.lastIndexOf('\nexport ', match.index),
    );
    if (start < 0) continue;
    // Type-only imports vanish at build time and cannot reach the browser.
    if (/^\n(?:import|export) type[\s{]/.test(text.slice(start, start + 16))) continue;
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) specifiers.push(match[1]);
  return specifiers;
};

const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
};

/** Every Node dependency reachable from `entry` through value imports. */
const collectNodeReach = (entry: string) => {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const where = path.relative(PACKAGE_ROOT, file);

    const ownerDir = NODE_ONLY_DIRS.find((dir) => file.startsWith(`${dir}${path.sep}`));
    if (ownerDir) {
      offenders.push(`${where} belongs to Node-only ${path.relative(PACKAGE_ROOT, ownerDir)}`);
      continue;
    }

    const source = stripComments(readFileSync(file, 'utf8'));
    const global = source.match(NODE_GLOBAL);
    if (global) offenders.push(`${where} uses ${global[0]}`);

    for (const specifier of staticValueImports(source)) {
      if (NODE_BUILTINS.has(specifier)) {
        offenders.push(`${where} -> ${specifier}`);
      } else if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier);
        if (resolved) queue.push(resolved);
      }
    }
  }
  return offenders;
};

describe('runtime boundary', () => {
  it('lists only real entries as browser entries', () => {
    expect(BROWSER_ENTRIES.filter((entry) => !(entry in exportTargets))).toEqual([]);
  });

  it.each(BROWSER_ENTRIES)('browser entry %s reaches no Node code', (entry) => {
    expect(collectNodeReach(entryFile(entry))).toEqual([]);
  });
});
