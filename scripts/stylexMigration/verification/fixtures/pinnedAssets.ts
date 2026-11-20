import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

interface Asset {
  file: string;
  sha256: string;
  url: string;
}

/** Exact, hashed upstream assets only; all other external requests stay blocked. */
export const loadPinnedAssets = async (sourceDirectory: string) => {
  const directory = await realpath(path.join(sourceDirectory, 'fixtures/assets'));
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as Asset[];
  const assets = new Map<string, Buffer>();
  for (const asset of manifest) {
    if (
      !/^[a-z_-]+\.svg$/.test(asset.file) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !asset.url.startsWith('https://') ||
      assets.has(asset.url)
    )
      throw new Error('INVALID_PINNED_ASSET');
    const file = await realpath(path.join(directory, asset.file));
    if (!file.startsWith(directory + path.sep)) throw new Error('PINNED_ASSET_ESCAPE');
    const body = await readFile(file);
    if (createHash('sha256').update(body).digest('hex') !== asset.sha256)
      throw new Error('PINNED_ASSET_HASH_MISMATCH');
    assets.set(asset.url, body);
  }
  return assets;
};
