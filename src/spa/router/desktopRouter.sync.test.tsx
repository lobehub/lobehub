import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { matchRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';

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

function extractHandleMetas(source: string) {
  const metas: string[] = [];
  const marker = 'handle:';

  let cursor = source.indexOf(marker);
  while (cursor !== -1) {
    const braceStart = source.indexOf('{', cursor + marker.length);
    let depth = 0;
    let end = braceStart;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    metas.push(source.slice(braceStart, end + 1).replaceAll(/\s+/g, ' '));
    cursor = source.indexOf(marker, end + 1);
  }

  return metas.sort();
}

function extractPaths(source: string) {
  return [...source.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
}

function normalizePaths(paths: string[]) {
  return [...new Set(paths.map((path) => KNOWN_DIVERGENCES[path] ?? path))].sort();
}

async function readDesktopRouterSources() {
  return Promise.all([
    readFile(path.join(process.cwd(), 'src/spa/router/desktopRouter.config.tsx'), 'utf8'),
    readFile(path.join(process.cwd(), 'src/spa/router/desktopRouter.config.desktop.tsx'), 'utf8'),
  ]);
}

describe('desktopRouter config sync', () => {
  it('personal memory settings route is not shadowed by workspace memory route', () => {
    const matches = matchRoutes(desktopRoutes, '/settings/memory');
    const paths = matches?.map((match) => match.route.path);

    expect(paths).toContain('settings');
    expect(paths).not.toContain(':workspaceSlug');
    expect(paths?.at(-1)).toBe('memory');
    expect(matches?.at(-1)?.route.handle).toMatchObject({ settingsTab: 'memory' });
  });

  it('desktop (sync) route paths must match web (async) route paths', async () => {
    const [asyncSource, syncSource] = await readDesktopRouterSources();

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

  it('route handle.meta declarations must match between web and desktop configs', async () => {
    const [asyncSource, syncSource] = await readDesktopRouterSources();

    const asyncMetas = extractHandleMetas(asyncSource);
    const syncMetas = extractHandleMetas(syncSource);

    expect(asyncMetas.length, 'Async config must declare at least one handle.meta').toBeGreaterThan(
      0,
    );
    expect(syncMetas, 'Desktop config handle.meta declarations must match async config').toEqual(
      asyncMetas,
    );
  });

  it('workspace settings tree is registered with all tabs in both configs', async () => {
    const [asyncSource, syncSource] = await readDesktopRouterSources();

    const requiredImportTargets = [
      '@/routes/(main)/[workspaceSlug]/settings/_layout',
      '@/routes/(main)/[workspaceSlug]/settings/general',
      '@/routes/(main)/[workspaceSlug]/settings/members',
      '@/routes/(main)/[workspaceSlug]/settings/plans',
      '@/routes/(main)/[workspaceSlug]/settings/billing',
      '@/routes/(main)/[workspaceSlug]/settings/credits',
      '@/routes/(main)/[workspaceSlug]/settings/usage',
      '@/routes/(main)/[workspaceSlug]/settings/skill',
    ];

    for (const target of requiredImportTargets) {
      expect(asyncSource, `async config missing ${target}`).toContain(`import('${target}')`);
      expect(syncSource, `sync config missing ${target}`).toContain(`from '${target}'`);
    }

    // Old billing route directory is gone in both configs
    expect(asyncSource).not.toContain('@/routes/(main)/[workspaceSlug]/billing/_layout');
    expect(asyncSource).not.toContain('@/routes/(main)/[workspaceSlug]/billing/plans');
    expect(syncSource).not.toContain('@/routes/(main)/[workspaceSlug]/billing/_layout');
    expect(syncSource).not.toContain('@/routes/(main)/[workspaceSlug]/billing/plans');

    // Legacy /:slug/billing/* redirects still exist (string match — the
    // `path: 'billing'` block under `:workspaceSlug` is preserved as redirects)
    expect(asyncSource).toContain("redirectElement('../settings/plans')");
    expect(syncSource).toContain("redirectElement('../settings/plans')");
  });

  it('task list and detail desktop routes share one workspace layout', async () => {
    const [asyncSource, syncSource] = await readDesktopRouterSources();

    expect(asyncSource).toContain("import('@/routes/(main)/(task-workspace)/_layout')");
    expect(syncSource).toContain("from '@/routes/(main)/(task-workspace)/_layout'");
    expect(asyncSource).toContain("import('@/routes/(main)/agent/task/[taskId]')");
    expect(syncSource).toContain("from '@/routes/(main)/agent/task/[taskId]'");
    expect(asyncSource).not.toContain("import('@/routes/(main)/task-workspace/_layout')");
    expect(syncSource).not.toContain("from '@/routes/(main)/task-workspace/_layout'");
    expect(asyncSource).not.toContain("import('@/routes/(main)/tasks/_layout')");
    expect(asyncSource).not.toContain("import('@/routes/(main)/task/_layout')");
    expect(syncSource).not.toContain("from '@/routes/(main)/tasks/_layout'");
    expect(syncSource).not.toContain("from '@/routes/(main)/task/_layout'");
  });
});
