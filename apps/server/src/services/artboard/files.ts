import { createHash } from 'node:crypto';

import {
  ARTBOARD_FILE_LIMITS,
  artboardFileContentType,
  isArtboardImagePath,
  isArtboardTextPath,
  normalizeArtboardFilePath,
} from '@lobechat/types';
import pMap from 'p-map';

import { ArtboardFileModel } from '@/database/models/artboard/file';
import type { ArtboardFileRow } from '@/database/models/artboard/types';
import type { LobeChatDatabase, Transaction } from '@/database/type';

import { ArtboardServiceError } from './errors';

export interface ArtboardBlobStore {
  delete: (keys: string[]) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
  read: (key: string) => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
}

export interface ArtboardImageBytes {
  bytes: Uint8Array;
  contentType: string;
}

export type ArtboardFileWrite =
  | { content: string; fileRef?: never; path: string }
  | { content?: never; fileRef: string; path: string };

export interface ArtboardFileEdit {
  newText: string;
  oldText: string;
  path: string;
}

export interface ArtboardFileChanges {
  deletes?: string[];
  edits?: ArtboardFileEdit[];
  writes?: ArtboardFileWrite[];
}

export interface ArtboardChangedFile {
  hash: string;
  path: string;
  size: number;
}

export interface ArtboardFileContent {
  bytes: Uint8Array;
  content?: string;
  contentType: string;
  hash: string;
  path: string;
}

interface ArtboardFileServiceDeps {
  db: LobeChatDatabase;
  resolveImage: (fileRef: string) => Promise<ArtboardImageBytes | undefined>;
  store: ArtboardBlobStore;
  userId: string;
  workspaceId?: string;
}

interface PendingFile extends ArtboardChangedFile {
  bytes?: Uint8Array;
  contentType: string;
}

export interface PreparedArtboardFiles {
  changed: ArtboardChangedFile[];
  deletes: string[];
  files: Map<string, Pick<PendingFile, 'contentType' | 'hash' | 'path' | 'size'>>;
  upserts: PendingFile[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const invalid = (message: string): never => {
  throw new ArtboardServiceError('invalid', message);
};

export const artboardBlobKey = (artboardId: string, hash: string) =>
  `artboards/${artboardId}/${hash}`;

const artboardBlobPrefix = (artboardId: string) => `artboards/${artboardId}/`;

const requirePath = (path: string) =>
  normalizeArtboardFilePath(path) ??
  invalid(
    `"${path}" is not a valid artboard file path: use a relative path (no "..") of letters, digits and -_.@ ending in a known extension (html, css, js, json, svg, png, jpg, webp, gif, woff2…).`,
  );

const sizeLimitOf = (path: string) =>
  isArtboardImagePath(path)
    ? ARTBOARD_FILE_LIMITS.maxImageBytes
    : ARTBOARD_FILE_LIMITS.maxTextFileBytes;

const countOccurrences = (text: string, part: string) => {
  if (!part) return 0;
  let count = 0;
  for (
    let index = text.indexOf(part);
    index !== -1;
    index = text.indexOf(part, index + part.length)
  )
    count += 1;
  return count;
};

const BLOB_CONCURRENCY = 6;

export class ArtboardFileService {
  private model: ArtboardFileModel;

  constructor(private deps: ArtboardFileServiceDeps) {
    this.model = new ArtboardFileModel(deps.db, deps.userId, deps.workspaceId);
  }

  list = (artboardId: string): Promise<ArtboardFileRow[]> => this.model.list(artboardId);

  async read(artboardId: string, path: string): Promise<ArtboardFileContent> {
    const normalized = requirePath(path);
    const row = (await this.model.list(artboardId)).find((file) => file.path === normalized);
    if (!row)
      throw new ArtboardServiceError(
        'not_found',
        `Artboard "${artboardId}" has no file "${path}".`,
      );
    const bytes = await this.deps.store.read(artboardBlobKey(artboardId, row.hash));
    return {
      bytes,
      ...(isArtboardTextPath(row.path) ? { content: decoder.decode(bytes) } : {}),
      contentType: row.contentType,
      hash: row.hash,
      path: row.path,
    };
  }

  async readBlob(artboardId: string, hash: string) {
    return this.deps.store.read(artboardBlobKey(artboardId, hash));
  }

  async prepare(artboardId: string, changes: ArtboardFileChanges): Promise<PreparedArtboardFiles> {
    const existing = await this.model.list(artboardId);
    const files = new Map<string, Pick<PendingFile, 'contentType' | 'hash' | 'path' | 'size'>>(
      existing.map((row) => [row.path, row]),
    );
    const pending = new Map<string, PendingFile>();
    const deletes: string[] = [];

    const put = (path: string, bytes: Uint8Array, contentType: string) => {
      if (bytes.byteLength > sizeLimitOf(path))
        invalid(`"${path}" is ${bytes.byteLength} bytes; the limit is ${sizeLimitOf(path)}.`);
      const file = { bytes, contentType, hash: sha256(bytes), path, size: bytes.byteLength };
      pending.set(path, file);
      files.set(path, file);
    };

    for (const write of changes.writes ?? []) {
      const path = requirePath(write.path);
      const contentType = artboardFileContentType(path)!;
      if (write.fileRef !== undefined) {
        if (!isArtboardImagePath(path))
          invalid(`"${path}" takes text content; only image paths can be written from a fileRef.`);
        const image = await this.deps.resolveImage(write.fileRef);
        if (!image)
          throw new ArtboardServiceError(
            'source_denied',
            `fileRef "${write.fileRef}" does not match an image you can access. Use a file id from <file id> or an image ref from <image ref> in this conversation.`,
          );
        put(path, image.bytes, contentType);
        continue;
      }
      if (!isArtboardTextPath(path))
        invalid(`"${path}" is binary; write it from a fileRef instead of text content.`);
      put(path, encoder.encode(write.content ?? ''), contentType);
    }

    for (const change of changes.edits ?? []) {
      const path = requirePath(change.path);
      if (!isArtboardTextPath(path)) invalid(`"${path}" is not a text file and cannot be edited.`);
      const current = pending.get(path);
      const known = files.get(path);
      if (!known) invalid(`Artboard has no file "${path}" to edit.`);
      const text = decoder.decode(
        current?.bytes ?? (await this.deps.store.read(artboardBlobKey(artboardId, known!.hash))),
      );
      const count = countOccurrences(text, change.oldText);
      if (count !== 1)
        invalid(
          count === 0
            ? `The text to replace was not found in "${path}". Read the file and copy the exact text.`
            : `The text to replace appears ${count} times in "${path}"; include more surrounding text so it appears once.`,
        );
      put(
        path,
        encoder.encode(text.replace(change.oldText, () => change.newText)),
        known!.contentType,
      );
    }

    for (const raw of changes.deletes ?? []) {
      const path = requirePath(raw);
      if (!files.has(path)) invalid(`Artboard has no file "${path}" to delete.`);
      files.delete(path);
      pending.delete(path);
      deletes.push(path);
    }

    if (files.size > ARTBOARD_FILE_LIMITS.maxFiles)
      invalid(
        `An artboard holds at most ${ARTBOARD_FILE_LIMITS.maxFiles} files; this would make ${files.size}.`,
      );
    const total = [...files.values()].reduce((sum, file) => sum + file.size, 0);
    if (total > ARTBOARD_FILE_LIMITS.maxTotalBytes)
      invalid(
        `The artboard's files would total ${total} bytes; the limit is ${ARTBOARD_FILE_LIMITS.maxTotalBytes}.`,
      );

    const upserts = [...pending.values()];
    await pMap(
      upserts,
      (file) =>
        this.deps.store.write(
          artboardBlobKey(artboardId, file.hash),
          file.bytes!,
          file.contentType,
        ),
      { concurrency: BLOB_CONCURRENCY },
    );

    return {
      changed: upserts.map(({ hash, path, size }) => ({ hash, path, size })),
      deletes,
      files,
      upserts,
    };
  }

  async commit(artboardId: string, prepared: PreparedArtboardFiles, tx?: Transaction) {
    const model = tx ? this.model.withTransaction(tx) : this.model;
    await model.upsert(
      artboardId,
      prepared.upserts.map(({ contentType, hash, path, size }) => ({
        contentType,
        hash,
        path,
        size,
      })),
    );
    await model.delete(artboardId, prepared.deletes);
  }

  async applyChanges(artboardId: string, changes: ArtboardFileChanges) {
    const prepared = await this.prepare(artboardId, changes);
    await this.deps.db.transaction((tx) => this.commit(artboardId, prepared, tx));
    return prepared.changed;
  }

  async removeAll(artboardId: string) {
    const keys = await this.deps.store.list(artboardBlobPrefix(artboardId));
    if (keys.length) await this.deps.store.delete(keys);
  }
}
