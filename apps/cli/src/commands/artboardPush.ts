import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isArtboardTextPath, normalizeArtboardFilePath } from '@lobechat/types';

interface RemoteFile {
  hash: string;
  path: string;
  size: number;
}

type FileWrite = { base64: string; path: string } | { content: string; path: string };

interface ArtboardFilesApi {
  listFiles: { query: (input: { id: string }) => Promise<RemoteFile[]> };
  writeFiles: {
    mutate: (input: {
      files: { deletes?: string[]; writes?: FileWrite[] };
      id: string;
    }) => Promise<unknown>;
  };
}

export interface ArtboardPushResult {
  deleted: string[];
  skipped: string[];
  unchanged: string[];
  uploaded: string[];
}

const BATCH_BYTES = 4 * 1024 * 1024;

const listLocal = (root: string, dir = root): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listLocal(root, full);
    return entry.isFile() ? [path.relative(root, full).split(path.sep).join('/')] : [];
  });

const toWrite = (relative: string, bytes: Buffer): FileWrite =>
  isArtboardTextPath(relative)
    ? { content: bytes.toString('utf8'), path: relative }
    : { base64: bytes.toString('base64'), path: relative };

export const pushArtboardDir = async (
  api: ArtboardFilesApi,
  id: string,
  dir: string,
  options: { prune?: boolean },
): Promise<ArtboardPushResult> => {
  const remote = new Map((await api.listFiles.query({ id })).map((file) => [file.path, file.hash]));
  const result: ArtboardPushResult = { deleted: [], skipped: [], unchanged: [], uploaded: [] };
  const local = new Set<string>();
  const batches: FileWrite[][] = [];
  let batch: FileWrite[] = [];
  let batchBytes = 0;

  for (const relative of listLocal(dir).sort()) {
    const normalized = normalizeArtboardFilePath(relative);
    if (!normalized) {
      result.skipped.push(relative);
      continue;
    }
    local.add(normalized);
    const bytes = fs.readFileSync(path.join(dir, relative));
    if (remote.get(normalized) === createHash('sha256').update(bytes).digest('hex')) {
      result.unchanged.push(normalized);
      continue;
    }
    if (batch.length && batchBytes + bytes.byteLength > BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(toWrite(normalized, bytes));
    batchBytes += bytes.byteLength;
    result.uploaded.push(normalized);
  }
  if (batch.length) batches.push(batch);

  for (const writes of batches) await api.writeFiles.mutate({ files: { writes }, id });

  if (options.prune) {
    const deletes = [...remote.keys()].filter((file) => !local.has(file));
    if (deletes.length) {
      await api.writeFiles.mutate({ files: { deletes }, id });
      result.deleted = deletes;
    }
  }
  return result;
};
