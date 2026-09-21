import type { RendererDelta, RendererDeltaPackMetadata, RendererManifest } from './manifest';

export const indexLocalByHash = (localHashes: Map<string, string>): Map<string, string> => {
  const byHash = new Map<string, string>();
  for (const [localPath, hash] of localHashes) {
    if (!byHash.has(hash)) byHash.set(hash, localPath);
  }
  return byHash;
};

export const pickDelta = (
  manifest: RendererManifest,
  localVersion: string,
): RendererDelta | undefined =>
  manifest.deltas?.find((delta) => delta.fromVersion === localVersion);

export const canApplyDelta = (
  metadata: RendererDeltaPackMetadata,
  byHash: Map<string, string>,
): boolean => {
  const objects = new Set(metadata.objects);
  const patches = new Map(metadata.patches.map((patch) => [patch.toSha256, patch]));

  return metadata.tree.every((file) => {
    if (byHash.has(file.sha256) || objects.has(file.sha256)) return true;
    const patch = patches.get(file.sha256);
    return !!patch && byHash.has(patch.fromSha256);
  });
};
