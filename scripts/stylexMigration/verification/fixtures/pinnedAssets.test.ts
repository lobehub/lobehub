import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadPinnedAssets } from './pinnedAssets';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const setup = async (overrides: Record<string, string> = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stylex-pinned-assets-'));
  directories.push(root);
  const directory = path.join(root, 'fixtures/assets');
  await mkdir(directory, { recursive: true });
  const body = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const asset = {
    file: 'react_ts.svg',
    sha256: createHash('sha256').update(body).digest('hex'),
    url: 'https://example.test/pinned.svg',
    ...overrides,
  };
  await writeFile(path.join(directory, 'react_ts.svg'), body);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify([asset]));
  return { root, asset, body };
};

describe('loadPinnedAssets', () => {
  it('loads the exact asset and leaves unlisted URLs unavailable', async () => {
    const { root, asset, body } = await setup();
    const assets = await loadPinnedAssets(root);
    expect(assets.get(asset.url)?.toString()).toBe(body);
    expect(assets.has('https://example.test/other.svg')).toBe(false);
  });

  it('rejects changed upstream bytes', async () => {
    const { root } = await setup({ sha256: '0'.repeat(64) });
    await expect(loadPinnedAssets(root)).rejects.toThrow('PINNED_ASSET_HASH_MISMATCH');
  });

  it('rejects a manifest path outside its asset directory', async () => {
    const { root } = await setup({ file: '../outside.svg' });
    await expect(loadPinnedAssets(root)).rejects.toThrow('INVALID_PINNED_ASSET');
  });
});
