import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fixtureDataBoundary, workspaceExports } from './fixtureResolvers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});
const setup = async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'stylex-resolver-')));
  roots.push(root);
  await mkdir(path.join(root, 'packages/example'), { recursive: true });
  await mkdir(path.join(root, 'host'));
  await writeFile(path.join(root, 'host/data.ts'), 'export const value = 1;');
  await writeFile(path.join(root, 'packages/example/index.ts'), 'export const value = 2;');
  await writeFile(
    path.join(root, 'packages/example/package.json'),
    JSON.stringify({
      name: '@example/pkg',
      exports: {
        '.': './index.ts',
        './conditional': { import: './index.ts' },
        './escape': './../../outside.ts',
      },
    }),
  );
  await writeFile(path.join(root, 'outside.ts'), '');
  return root;
};

// Vite accepts an object hook or a function; these plugins deliberately use functions.
const resolver = (plugin: Awaited<ReturnType<typeof workspaceExports>>) => {
  if (typeof plugin.resolveId !== 'function') throw new Error('EXPECTED_RESOLVE_FUNCTION');
  const hook = plugin.resolveId;
  return (id: string, importer: string | undefined, _options: object) =>
    hook.call({} as never, id, importer, { isEntry: false });
};

describe('snapshot fixture resolvers', () => {
  it('replaces only the declared edge and records it', async () => {
    const root = await setup();
    const hits = new Set<string>();
    const resolve = resolver(
      fixtureDataBoundary(
        root,
        path.join(root, 'host'),
        [
          {
            importer: 'src/component.tsx',
            source: '@/store/test',
            replacement: 'data.ts',
          },
        ],
        hits,
      ),
    );
    expect(await resolve('@/store/test', path.join(root, 'src/other.tsx'), {})).toBeUndefined();
    expect(await resolve('@/store/test', path.join(root, 'src/component.tsx'), {})).toBe(
      path.join(root, 'host/data.ts'),
    );
    expect([...hits]).toEqual(['src/component.tsx:@/store/test']);
    expect(
      await resolve(path.join(root, 'src/store/test'), path.join(root, 'src/component.tsx'), {}),
    ).toBe(path.join(root, 'host/data.ts'));
  });

  it('rejects symlink escapes from the fixture boundary', async () => {
    const root = await setup();
    await symlink(path.join(root, 'outside.ts'), path.join(root, 'host/escape.ts'));
    const resolve = resolver(
      fixtureDataBoundary(
        root,
        path.join(root, 'host'),
        [
          {
            importer: 'src/component.tsx',
            source: 'data',
            replacement: 'escape.ts',
          },
        ],
        new Set(),
      ),
    );
    await expect(resolve('data', path.join(root, 'src/component.tsx'), {})).rejects.toThrow(
      'FIXTURE_BOUNDARY_ESCAPE',
    );
  });

  it('uses version-local explicit exports and fails closed on unsupported maps', async () => {
    const root = await setup();
    const resolve = resolver(await workspaceExports(root));
    expect(await resolve('@example/pkg', undefined, {})).toBe(
      path.join(root, 'packages/example/index.ts'),
    );
    expect(await resolve('react', undefined, {})).toBeUndefined();
    await expect(resolve('@example/pkg/conditional', undefined, {})).rejects.toThrow(
      'WORKSPACE_EXPORT_UNSUPPORTED',
    );
    await expect(resolve('@example/pkg/missing', undefined, {})).rejects.toThrow(
      'WORKSPACE_EXPORT_UNSUPPORTED',
    );
    await expect(resolve('@example/pkg/escape', undefined, {})).rejects.toThrow(
      'WORKSPACE_EXPORT_ESCAPE',
    );
  });
});
