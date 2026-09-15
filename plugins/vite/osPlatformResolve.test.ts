import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveOsPlatform, viteOsPlatformResolve } from './osPlatformResolve';

const temporaryDirectories: string[] = [];

const createFixture = async (files: Record<string, string>) => {
  const directory = await mkdtemp(join(tmpdir(), 'vite-os-platform-resolve-'));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(join(directory, name), contents)),
  );
  return directory;
};

const resolveWithPlugin = async (
  os: 'linux' | 'mac' | 'windows',
  source: string,
  importer: string,
  resolvedId: string,
) => {
  const plugin = viteOsPlatformResolve(os);
  const resolve = vi.fn().mockResolvedValue({ id: resolvedId });
  return plugin.resolveId?.call({ resolve } as never, source, importer, {});
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('resolveOsPlatform', () => {
  it('maps node and electron-builder platforms onto file suffixes', () => {
    expect(resolveOsPlatform('darwin')).toBe('mac');
    expect(resolveOsPlatform('win32')).toBe('windows');
    expect(resolveOsPlatform('linux')).toBe('linux');
    expect(resolveOsPlatform('freebsd')).toBe('linux');
  });
});

describe('viteOsPlatformResolve', () => {
  it('rewrites a base import to the matching os suffix when that file exists', async () => {
    const directory = await createFixture({
      'widget.mac.ts': 'export const platform = "mac";\n',
      'widget.ts': 'export const platform = "base";\n',
    });

    await expect(
      resolveWithPlugin(
        'mac',
        './widget',
        join(directory, 'entry.ts'),
        join(directory, 'widget.ts'),
      ),
    ).resolves.toBe(join(directory, 'widget.mac.ts'));
  });

  it('keeps the base file when the current os has no overlay', async () => {
    const directory = await createFixture({
      'widget.mac.ts': 'export const platform = "mac";\n',
      'widget.ts': 'export const platform = "base";\n',
    });

    await expect(
      resolveWithPlugin(
        'windows',
        './widget',
        join(directory, 'entry.ts'),
        join(directory, 'widget.ts'),
      ),
    ).resolves.toBeNull();
  });

  it('does not rewrite an overlay that imports the base module', async () => {
    const directory = await createFixture({
      'widget.mac.ts': 'export { platform } from "./widget";\n',
      'widget.ts': 'export const platform = "base";\n',
    });

    await expect(
      resolveWithPlugin(
        'mac',
        './widget',
        join(directory, 'widget.mac.ts'),
        join(directory, 'widget.ts'),
      ),
    ).resolves.toBeNull();
  });
});
