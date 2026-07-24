import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDesktopViteConfigExtension } from './vite.shared';

describe('applyDesktopViteConfigExtension', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it('loads named exports from TypeScript extensions through the Vite module runner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lobe-desktop-vite-extension-'));
    const extensionPath = path.join(directory, 'extension.mts');
    temporaryDirectories.push(directory);

    await writeFile(
      extensionPath,
      `export const extendDesktopViteConfig = ({ config, target }) => ({
  ...config,
  define: { __TEST_TARGET__: JSON.stringify(target) },
});
`,
    );
    vi.stubEnv('LOBE_DESKTOP_VITE_CONFIG_EXTENSION', extensionPath);

    const config = await applyDesktopViteConfigExtension(
      'main',
      {},
      { command: 'build', mode: 'development' },
    );

    expect(config.define).toEqual({ __TEST_TARGET__: '"main"' });
  });
});
