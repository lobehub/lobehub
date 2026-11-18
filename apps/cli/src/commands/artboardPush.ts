import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type ArtboardContent,
  isArtboardTextPath,
  normalizeArtboardFilePath,
} from '@lobechat/types';

interface RemoteFile {
  hash: string;
  path: string;
  size: number;
}

type FileWrite =
  | { base64: string; path: string }
  | { content: string; path: string }
  | { hash: string; path: string };

export interface ArtboardFilesApi {
  listFiles: { query: (input: { id: string }) => Promise<RemoteFile[]> };
  prepareFileUploads: {
    mutate: (input: {
      files: { hash: string; path: string; size: number }[];
      id: string;
    }) => Promise<{ uploads: { headers?: Record<string, string>; path: string; url: string }[] }>;
  };
  read: {
    query: (input: {
      id: string;
    }) => Promise<{ artboard: { content: Pick<ArtboardContent, 'boards'> } }>;
  };
  writeFiles: {
    mutate: (input: {
      files: { deletes?: string[]; writes?: FileWrite[] };
      id: string;
    }) => Promise<unknown>;
  };
}

export interface LocalArtboardFile {
  bytes: Buffer;
  hash: string;
  path: string;
}

export interface ArtboardPushResult {
  deleted: string[];
  /** Remote files missing locally that `--prune` left alone because a board shows them. */
  kept: { path: string; title: string }[];
  skipped: string[];
  unchanged: string[];
  uploaded: string[];
}

/**
 * Encoded JSON size of one writeFiles request. Vercel rejects bodies over 4.5 MB
 * and tRPC can batch other calls into the same request, so stay at 2 MB like
 * the web client's message write batcher.
 */
const BATCH_BYTES = 2 * 1024 * 1024;

const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export const toLocalArtboardFile = (relative: string, bytes: Buffer): LocalArtboardFile => ({
  bytes,
  hash: createHash('sha256').update(bytes).digest('hex'),
  path: relative,
});

const putBlob = async (
  file: LocalArtboardFile,
  upload: { headers?: Record<string, string>; url: string },
) => {
  const response = await fetch(upload.url, {
    body: file.bytes,
    headers: upload.headers,
    method: 'PUT',
  }).catch((error: unknown) => {
    throw new Error(`Upload of ${file.path} failed: ${(error as Error)?.message ?? String(error)}`);
  });
  if (!response.ok)
    throw new Error(`Upload of ${file.path} failed: ${response.status} ${response.statusText}`);
};

/**
 * Writes files to an artboard in requests of at most 2 MB encoded. A file too
 * large for one request is PUT to storage through a presigned URL first and
 * then committed by its hash.
 */
export const writeArtboardFiles = async (
  api: Pick<ArtboardFilesApi, 'prepareFileUploads' | 'writeFiles'>,
  id: string,
  files: LocalArtboardFile[],
) => {
  const envelope = encodedBytes({ files: { writes: [] }, id });
  const writes: FileWrite[] = [];
  const large: LocalArtboardFile[] = [];
  for (const file of files) {
    const write: FileWrite = isArtboardTextPath(file.path)
      ? { content: file.bytes.toString('utf8'), path: file.path }
      : { base64: file.bytes.toString('base64'), path: file.path };
    if (envelope + encodedBytes(write) > BATCH_BYTES) large.push(file);
    else writes.push(write);
  }

  if (large.length) {
    const { uploads } = await api.prepareFileUploads.mutate({
      files: large.map((file) => ({
        hash: file.hash,
        path: file.path,
        size: file.bytes.byteLength,
      })),
      id,
    });
    const byPath = new Map(uploads.map((upload) => [upload.path, upload]));
    for (const file of large) {
      const upload = byPath.get(file.path);
      if (upload) await putBlob(file, upload);
      writes.push({ hash: file.hash, path: file.path });
    }
  }

  let batch: FileWrite[] = [];
  let batchBytes = envelope;
  for (const write of writes) {
    // +1 for the comma between array items
    const bytes = encodedBytes(write) + 1;
    if (batch.length && batchBytes + bytes > BATCH_BYTES) {
      await api.writeFiles.mutate({ files: { writes: batch }, id });
      batch = [];
      batchBytes = envelope;
    }
    batch.push(write);
    batchBytes += bytes;
  }
  if (batch.length) await api.writeFiles.mutate({ files: { writes: batch }, id });
};

const listLocal = (root: string, dir = root): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listLocal(root, full);
    return entry.isFile() ? [path.relative(root, full).split(path.sep).join('/')] : [];
  });

export const pushArtboardDir = async (
  api: ArtboardFilesApi,
  id: string,
  dir: string,
  options: { prune?: boolean },
): Promise<ArtboardPushResult> => {
  const remote = new Map((await api.listFiles.query({ id })).map((file) => [file.path, file.hash]));
  const result: ArtboardPushResult = {
    deleted: [],
    kept: [],
    skipped: [],
    unchanged: [],
    uploaded: [],
  };
  const local = new Set<string>();
  const changed: LocalArtboardFile[] = [];

  for (const relative of listLocal(dir).sort()) {
    const normalized = normalizeArtboardFilePath(relative);
    if (!normalized) {
      result.skipped.push(relative);
      continue;
    }
    local.add(normalized);
    const file = toLocalArtboardFile(normalized, fs.readFileSync(path.join(dir, relative)));
    if (remote.get(normalized) === file.hash) {
      result.unchanged.push(normalized);
      continue;
    }
    changed.push(file);
    result.uploaded.push(normalized);
  }

  await writeArtboardFiles(api, id, changed);

  if (options.prune) {
    const missing = [...remote.keys()].filter((file) => !local.has(file));
    if (missing.length) {
      // The server refuses to delete a file a board shows; keep those instead of failing the prune.
      const { artboard } = await api.read.query({ id });
      const shownBy = new Map<string, string>();
      for (const board of artboard.content.boards)
        if (board.source && !shownBy.has(board.source.path))
          shownBy.set(board.source.path, board.title);

      const deletes: string[] = [];
      for (const file of missing) {
        const title = shownBy.get(file);
        if (title === undefined) deletes.push(file);
        else result.kept.push({ path: file, title });
      }
      if (deletes.length) {
        await api.writeFiles.mutate({ files: { deletes }, id });
        result.deleted = deletes;
      }
    }
  }
  return result;
};
