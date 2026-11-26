// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const git = (args: string[], cwd = process.cwd()) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 });
const MODULE_PATTERN = /\.[cm]?[jt]sx?$/;

/**
 * Tracked and new (not ignored) files on disk, so a local collision fails before
 * it is committed and a deletion not yet staged does not count.
 */
const listFiles = () => {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  return git(['ls-files', '--cached', '--others', '--exclude-standard'], root)
    .split('\n')
    .filter((file) => file && existsSync(path.join(root, file)));
};

/**
 * Module paths (extension dropped) that differ only by letter case. macOS and
 * Windows filesystems are case-insensitive by default, so an import of one
 * resolves to whichever the resolver finds first, e.g. `./CustomSkills` loading
 * `customSkills.ts` instead of `CustomSkills.tsx`.
 */
const findCaseCollisions = (files: string[]) => {
  const byKey = new Map<string, Set<string>>();
  for (const file of files) {
    if (!MODULE_PATTERN.test(file)) continue;
    const modulePath = file.replace(MODULE_PATTERN, '');
    const key = modulePath.toLowerCase();
    byKey.set(key, (byKey.get(key) ?? new Set()).add(modulePath));
  }
  return [...byKey.values()].filter((paths) => paths.size > 1).map((paths) => [...paths].sort());
};

describe('module names', () => {
  it('flags modules whose paths differ only by case', () => {
    expect(
      findCaseCollisions([
        'src/a/CustomSkills.tsx',
        'src/a/customSkills.ts',
        'src/a/index.ts',
        'src/a/index.tsx',
      ]),
    ).toEqual([['src/a/CustomSkills', 'src/a/customSkills']]);
  });

  it('has no case-only collisions in the repository', () => {
    expect(findCaseCollisions(listFiles())).toEqual([]);
  });
});
