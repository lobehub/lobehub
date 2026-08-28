import { promisify } from 'node:util';
import { constants, zstdCompress } from 'node:zlib';

const zstdCompressAsync = promisify(zstdCompress);

export const MIN_PATCH_BYTES = 16 * 1024;
const MAX_PATCH_RATIO = 0.5;
const RECENT_DELTA_KEEP = 2;

const VITE_CONTENT_HASH = /-[\w-]{8}(?=\.[^./]+$)/;

export const logicalKey = (filePath) => filePath.replace(VITE_CONTENT_HASH, '');

const versionNumber = (version) => Number(String(version).replace(/^r/, ''));

export const candidateDeltaVersions = (currentVersion) => {
  const current = versionNumber(currentVersion);
  if (!Number.isFinite(current) || current <= 0) return [];
  const nums = new Set([0]);
  for (let i = 1; i <= RECENT_DELTA_KEEP; i += 1) {
    const n = current - i;
    if (n > 0) nums.add(n);
  }
  return [...nums]
    .filter((n) => n < current)
    .sort((a, b) => a - b)
    .map((n) => `r${n}`);
};

export const pairRendererFiles = (fromFiles, toFiles) => {
  const usedFrom = new Set();
  const pairings = [];

  const fromByHash = new Map();
  for (const file of fromFiles) {
    if (!fromByHash.has(file.sha256)) fromByHash.set(file.sha256, file);
  }

  const unmatchedTo = [];
  for (const to of toFiles) {
    const from = fromByHash.get(to.sha256);
    if (from && !usedFrom.has(from.path)) {
      usedFrom.add(from.path);
      pairings.push({ from, kind: 'copy', to });
    } else {
      unmatchedTo.push(to);
    }
  }

  const remainingFrom = () => fromFiles.filter((file) => !usedFrom.has(file.path));

  const fromByPath = new Map(remainingFrom().map((file) => [file.path, file]));
  const afterPath = [];
  for (const to of unmatchedTo) {
    const from = fromByPath.get(to.path);
    if (from) {
      usedFrom.add(from.path);
      pairings.push({ from, kind: 'patch', to });
    } else {
      afterPath.push(to);
    }
  }

  const fromByKey = new Map();
  for (const file of remainingFrom()) {
    const key = logicalKey(file.path);
    const group = fromByKey.get(key) ?? [];
    group.push(file);
    fromByKey.set(key, group);
  }

  for (const to of afterPath) {
    const group = fromByKey.get(logicalKey(to.path));
    if (!group?.length) {
      pairings.push({ kind: 'full', to });
      continue;
    }
    group.sort((a, b) => Math.abs(a.size - to.size) - Math.abs(b.size - to.size));
    const from = group.shift();
    usedFrom.add(from.path);
    pairings.push({ from, kind: 'patch', to });
  }

  return pairings;
};

export const generateZstdPatch = async (oldContent, newContent) => {
  if (newContent.byteLength < MIN_PATCH_BYTES) return null;
  try {
    const patch = Buffer.from(
      await zstdCompressAsync(newContent, {
        dictionary: oldContent,
        params: { [constants.ZSTD_c_compressionLevel]: 19 },
      }),
    );
    if (patch.byteLength === 0 || patch.byteLength >= newContent.byteLength * MAX_PATCH_RATIO) {
      return null;
    }
    return Buffer.from(patch);
  } catch {
    return null;
  }
};
