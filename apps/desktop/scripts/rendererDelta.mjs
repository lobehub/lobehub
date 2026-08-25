import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

export const generateZstdPatch = async (oldPath, newPath, newSize) => {
  if (newSize < MIN_PATCH_BYTES) return null;

  const dir = await mkdtemp(path.join(tmpdir(), 'renderer-delta-'));
  const patchPath = path.join(dir, 'patch.zst');

  try {
    await execFileAsync(
      'zstd',
      ['--patch-from', oldPath, '-19', '-q', '-f', newPath, '-o', patchPath],
      { timeout: 120_000 },
    );
    const patch = await readFile(patchPath);
    if (patch.byteLength === 0 || patch.byteLength >= newSize * MAX_PATCH_RATIO) return null;
    return patch;
  } catch {
    return null;
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};
