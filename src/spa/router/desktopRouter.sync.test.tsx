import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Known path pairs that intentionally differ between web and desktop (Electron).
 * Map: desktop path → web path
 */
const KNOWN_DIVERGENCES: Record<string, string> = {
  '/desktop-onboarding': '/onboarding',
};

function extractIndexCount(source: string) {
  return [...source.matchAll(/index:\s*true/g)].length;
}

function extractPaths(source: string) {
  return [...source.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
}

function normalizePaths(paths: string[]) {
  return [...new Set(paths.map((path) => KNOWN_DIVERGENCES[path] ?? path))].sort();
}

describe('desktopRouter config sync', () => {
  it('desktop (sync) route paths must match web (async) route paths', async () => {
    const asyncSource = await readFile(
      join(process.cwd(), 'src/spa/router/desktopRouter.config.tsx'),
      'utf8',
    );
    const syncSource = await readFile(
      join(process.cwd(), 'src/spa/router/desktopRouter.config.desktop.tsx'),
      'utf8',
    );

    const asyncPaths = normalizePaths(extractPaths(asyncSource));
    const syncPaths = normalizePaths(extractPaths(syncSource));

    const missingInSync = asyncPaths.filter((p) => !syncPaths.includes(p));
    const extraInSync = syncPaths.filter((p) => !asyncPaths.includes(p));
    const asyncIndexCount = extractIndexCount(asyncSource);
    const syncIndexCount = extractIndexCount(syncSource);

    expect(missingInSync, `Missing in desktop config: ${missingInSync.join(', ')}`).toEqual([]);
    expect(extraInSync, `Extra in desktop config: ${extraInSync.join(', ')}`).toEqual([]);
    expect(syncIndexCount, 'Desktop config index route count must match async config').toBe(
      asyncIndexCount,
    );
  });
});
