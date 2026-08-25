import type { RendererDelta, RendererManifest } from './manifest';

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

export const canApplyDelta = (delta: RendererDelta, byHash: Map<string, string>): boolean =>
  delta.ops.every((op) => {
    if (op.op === 'copy') return byHash.has(op.sha256);
    if (op.op === 'patch') return byHash.has(op.fromSha256);
    return true;
  });
