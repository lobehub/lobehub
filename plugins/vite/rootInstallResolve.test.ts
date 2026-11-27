import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { viteRootInstallResolve } from './rootInstallResolve';

const temporaryDirectories: string[] = [];

/**
 * Mirrors the desktop checkout: the root install provides `lucide-react` and `@lobehub/ui`,
 * while `apps/desktop` and `packages/types` carry their own `node_modules` from the
 * standalone desktop install.
 */
const createWorkspace = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vite-root-install-resolve-'));
  temporaryDirectories.push(root);

  const files = {
    'apps/desktop/node_modules/lucide-react/package.json': '{"version":"1.57.0"}',
    'apps/desktop/src/overlay/ChatPanel.tsx': '',
    'node_modules/@lobehub/ui/package.json': '{}',
    'node_modules/lucide-react/package.json': '{"version":"1.81.0"}',
    'package.json': '{}',
    'packages/types/node_modules/@lobehub/a2ui/package.json': '{}',
    'packages/types/src/index.ts': '',
    'src/app.tsx': '',
  };
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents);
    }),
  );

  return root;
};

const resolveWithPlugin = async (root: string, source: string, importer: string) => {
  const plugin = viteRootInstallResolve({ rootDir: root });
  const resolve = vi.fn().mockResolvedValue({ id: `/resolved/${source}` });
  const resolveId = plugin.resolveId as (...args: unknown[]) => Promise<unknown>;
  const result = await resolveId.call({ resolve }, source, importer, { isEntry: false });

  return { resolve, result };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('viteRootInstallResolve', () => {
  it('only runs on the dev server', () => {
    expect(viteRootInstallResolve({ rootDir: '/repo' }).apply).toBe('serve');
  });

  it.each([
    ['apps/desktop/src/overlay/ChatPanel.tsx', 'lucide-react'],
    ['apps/desktop/src/overlay/ChatPanel.tsx', 'lucide-react/dynamic'],
    ['packages/types/src/index.ts', '@lobehub/ui/base-ui'],
  ])('resolves a bare import of %s against the root install', async (importer, source) => {
    const root = await createWorkspace();

    const { resolve, result } = await resolveWithPlugin(root, source, path.join(root, importer));

    expect(resolve).toHaveBeenCalledWith(source, path.join(root, 'package.json'), {
      isEntry: false,
      skipSelf: true,
    });
    expect(result).toEqual({ id: `/resolved/${source}` });
  });

  it.each([
    [
      'a root source file, which already resolves through the root install',
      'src/app.tsx',
      'lucide-react',
    ],
    [
      'an importer inside node_modules, which keeps the versions it pinned',
      'apps/desktop/node_modules/lucide-react/index.js',
      'lucide-react',
    ],
    ['a package the root install does not provide', 'packages/types/src/index.ts', '@lobehub/a2ui'],
    ['a path alias', 'apps/desktop/src/overlay/ChatPanel.tsx', '@/utils'],
    ['a relative import', 'apps/desktop/src/overlay/ChatPanel.tsx', './avatar.css'],
    ['a protocol import', 'apps/desktop/src/overlay/ChatPanel.tsx', 'node:path'],
  ])('leaves %s alone', async (_case, importer, source) => {
    const root = await createWorkspace();

    const { resolve, result } = await resolveWithPlugin(root, source, path.join(root, importer));

    expect(resolve).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
