import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const FROM_SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^import\s*['"]([^'"]+)['"]/gm;

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

/** Every file reachable from `entry` through value imports, with the Node builtins each one pulls. */
const collectNodeImports = (entry: string) => {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of staticValueImports(readFileSync(file, 'utf8'))) {
      if (NODE_BUILTINS.has(specifier)) {
        offenders.push(`${path.relative(__dirname, file)} -> ${specifier}`);
      } else if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier);
        if (resolved) queue.push(resolved);
      }
    }
  }
  return offenders;
};

/**
 * Regression: the package root is imported by the web app for labels and
 * helpers, and it re-exports every adapter. An adapter that pulled in a
 * `node:fs` reader put that module in the SPA's graph, where Vite's
 * externalized stub throws on first access and the whole app rendered blank.
 * Node-only code belongs behind a subpath entry (`./spawn`, `./rpc`, ...).
 */
describe('package root', () => {
  it('reaches no Node built-in module', () => {
    expect(collectNodeImports(path.join(__dirname, 'index.ts'))).toEqual([]);
  });
});
