import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DENSITY_VARS, generateDensityTokenFiles, toVarName } from './densityTokensCore';

// Vitest serves modules over http, so import.meta.url is not a file URL here. Both the npm
// script and CI run vitest from the repo root; the sync test asserts the spec is reachable.
const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const SPEC_FILE = path.join(sourceRoot, 'styles/densityScale.ts');

const SCANNED_EXTENSIONS = ['.css', '.less', '.ts', '.tsx'];
const VAR_REFERENCE = /var\((--lobe-density-[a-z-]+)/g;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];

    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

describe('density token codegen', () => {
  it('keeps the generated StyleX vars and compact theme in sync with densityScale.ts', () => {
    expect(existsSync(SPEC_FILE), `run vitest from the repo root (cwd: ${root})`).toBe(true);

    for (const file of generateDensityTokenFiles(root)) {
      expect(readFileSync(file.filePath, 'utf8'), `${file.relativePath} is stale`).toBe(
        file.content,
      );
    }
  });

  it('declares every --lobe-density-* variable that the app references', () => {
    const declared = new Set(DENSITY_VARS);
    const unknown = new Map<string, string[]>();

    for (const file of walk(sourceRoot)) {
      if (!SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;

      const relativePath = path.relative(root, file);
      for (const [, name] of readFileSync(file, 'utf8').matchAll(VAR_REFERENCE)) {
        if (declared.has(name)) continue;

        unknown.set(name, [...(unknown.get(name) ?? []), relativePath]);
      }
    }

    expect(
      Object.fromEntries(unknown),
      'Add these keys to densityScale.ts (they become --lobe-density-* automatically)',
    ).toEqual({});
  });

  it('derives kebab-case variable names from the scale keys', () => {
    expect(toVarName('controlHeight')).toBe('--lobe-density-control-height');
    expect(toVarName('pageTitleFontSize')).toBe('--lobe-density-page-title-font-size');
  });
});
