import path from 'node:path';

import type { PipelineEntry, RepoMount } from './types';

/**
 * stylelint's CSS-in-JS parser mangles ordinary template literals in files it
 * was never configured for (it corrupted this very script once): the repos
 * scope stylelint to `{src,tests}/**` in their `lint:style` scripts, so apply
 * the same boundary here instead of lint-staged's blanket `*.{ts,tsx}` glob.
 */
export const stylelintApplies = (subPath: string) => /^(?:src|tests)\//.test(subPath);

/**
 * Resolve a root-relative path to its owning mount and the path relative to
 * that mount. Longest mount dir prefix wins; the root mount (`dir: ''`) is the
 * fallback.
 */
export const resolveMount = (
  repos: RepoMount[],
  relPath: string,
): { mount: RepoMount; subPath: string } => {
  const match = repos
    .filter(
      (repo) => repo.dir !== '' && (relPath === repo.dir || relPath.startsWith(`${repo.dir}/`)),
    )
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  if (match) return { mount: match, subPath: relPath.slice(match.dir.length + 1) };

  const root = repos.find((repo) => repo.dir === '');
  if (!root) throw new Error('CheckConfig.repos must contain a root mount (dir: "")');
  return { mount: root, subPath: relPath };
};

/** Find the lint pipeline for a file, or null when no linter applies. */
export const pipelineFor = (pipelines: PipelineEntry[], subPath: string) => {
  const ext = path.extname(subPath).toLowerCase();
  return pipelines.find((entry) => entry.exts.includes(ext)) ?? null;
};

export const isTestFile = (relPath: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relPath);

/**
 * Related-test candidates for a source file: the file itself when it is a test,
 * otherwise sibling `<base>.test.*` and `__tests__/<base>.test.*`. Pure — the
 * caller filters candidates by on-disk existence.
 */
export const relatedTestCandidates = (relPath: string): string[] => {
  if (isTestFile(relPath)) return [relPath];
  if (!/\.[cm]?[jt]sx?$/.test(relPath)) return [];

  const dir = path.dirname(relPath);
  const base = path.basename(relPath).replace(/\.[^.]+$/, '');
  return ['.ts', '.tsx', '.mts'].flatMap((ext) => [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, '__tests__', `${base}.test${ext}`),
  ]);
};

/**
 * Nearest directory (walking up to the host root) containing a vitest config —
 * the "run vitest from the owning package" rule, automated.
 */
export const findVitestConfigDir = async (
  relPath: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  const configNames = ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.mjs'];
  let dir = path.dirname(relPath);

  while (true) {
    const candidates = configNames.map((name) => (dir === '.' ? name : path.join(dir, name)));
    const found = await Promise.all(candidates.map((candidate) => exists(candidate)));
    if (found.some(Boolean)) return dir;
    if (dir === '.') return '.';
    dir = path.dirname(dir);
  }
};
