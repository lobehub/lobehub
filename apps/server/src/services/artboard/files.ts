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
import type { FileService } from '@/server/services/file';

import { ArtboardServiceError } from './errors';

export interface ArtboardBlobUpload {
  headers?: Record<string, string>;
  url: string;
}

export interface ArtboardBlobStore {
  delete: (keys: string[]) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
  /** A signed PUT the client uploads one blob to, for files too large for a request body. */
  presignWrite: (key: string) => Promise<ArtboardBlobUpload>;
  read: (key: string) => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
}

export const createFileServiceArtboardBlobStore = (
  createFileService: () => FileService,
): ArtboardBlobStore => {
  let fileService: FileService | undefined;
  const service = () => (fileService ??= createFileService());
  return {
    delete: async (keys) => {
      await service().deleteFiles(keys);
    },
    list: (prefix) => service().listFileKeys(prefix),
    // Private: board files are only ever served through the token route.
    presignWrite: (key) => service().createPreSignedUpload(key, { private: true }),
    read: (key) => service().getFileByteArray(key),
    write: async (key, bytes, contentType) => {
      await service().uploadBuffer(key, Buffer.from(bytes), contentType);
    },
  };
};

export interface ArtboardImageBytes {
  bytes: Uint8Array;
  contentType: string;
}

type OneOf<T extends string> = {
  [K in Exclude<'base64' | 'content' | 'fileRef' | 'hash', T>]?: never;
};

export type ArtboardFileWrite =
  | (OneOf<'content'> & { content: string; path: string })
  | (OneOf<'fileRef'> & { fileRef: string; path: string })
  | (OneOf<'base64'> & { base64: string; path: string })
  /** A blob the client already PUT to a URL from prepareUploads, named by its sha256. */
  | (OneOf<'hash'> & { hash: string; path: string });

export interface ArtboardFileUploadRequest {
  hash: string;
  path: string;
  size: number;
}

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
  /** The blob is already in the store under its hash (a presigned upload). */
  stored?: boolean;
}

export interface PreparedArtboardFiles {
  /** Hash each edited or deleted file had when it was read; commit refuses if it moved on. */
  basis: Map<string, string>;
  changed: ArtboardChangedFile[];
  deletes: string[];
  upserts: PendingFile[];
}

export interface ArtboardCommittedFiles {
  /** Every file path of the artboard after the write. */
  paths: ReadonlySet<string>;
  /** Paths whose content changed or that were deleted. */
  touched: ReadonlySet<string>;
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

const requireHash = (hash: string) =>
  /^[\da-f]{64}$/.test(hash) ? hash : invalid(`"${hash}" is not a lowercase sha256 hex digest.`);

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

  /**
   * Signed PUT URLs for files too large to send in a request body. Content this artboard already
   * stores needs no upload. The bytes are only trusted once a `{path, hash}` write reads them
   * back and checks the hash.
   */
  async prepareUploads(
    artboardId: string,
    requests: ArtboardFileUploadRequest[],
  ): Promise<{ uploads: (ArtboardBlobUpload & { path: string })[] }> {
    const stored = new Set((await this.model.list(artboardId)).map((row) => row.hash));
    const pending = new Map<string, string>();
    for (const request of requests) {
      const path = requirePath(request.path);
      const hash = requireHash(request.hash);
      if (request.size > sizeLimitOf(path))
        invalid(`"${path}" is ${request.size} bytes; the limit is ${sizeLimitOf(path)}.`);
      if (!stored.has(hash) && !pending.has(hash)) pending.set(hash, path);
    }
    const uploads = await pMap(
      [...pending],
      async ([hash, path]) => ({
        path,
        ...(await this.deps.store.presignWrite(artboardBlobKey(artboardId, hash))),
      }),
      { concurrency: BLOB_CONCURRENCY },
    );
    return { uploads };
  }

  async prepare(
    artboardId: string,
    changes: ArtboardFileChanges,
    tx?: Transaction,
  ): Promise<PreparedArtboardFiles> {
    const existing = await (tx ? this.model.withTransaction(tx) : this.model).list(artboardId);
    const files = new Map<string, Pick<PendingFile, 'contentType' | 'hash' | 'path' | 'size'>>(
      existing.map((row) => [row.path, row]),
    );
    const pending = new Map<string, PendingFile>();
    const deletes: string[] = [];
    const basis = new Map<string, string>();
    const readFrom = (path: string) => {
      const row = existing.find((file) => file.path === path);
      if (row && !pending.has(path) && !basis.has(path)) basis.set(path, row.hash);
    };

    const put = (path: string, bytes: Uint8Array, contentType: string, stored = false) => {
      if (bytes.byteLength > sizeLimitOf(path))
        invalid(`"${path}" is ${bytes.byteLength} bytes; the limit is ${sizeLimitOf(path)}.`);
      const hash = sha256(bytes);
      const file = { bytes, contentType, hash, path, size: bytes.byteLength, stored };
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
      if (write.hash !== undefined) {
        const hash = requireHash(write.hash);
        const bytes = await this.deps.store
          .read(artboardBlobKey(artboardId, hash))
          .catch(() =>
            invalid(
              `"${path}" was not uploaded: get a URL from prepareFileUploads and PUT the bytes first.`,
            ),
          );
        if (sha256(bytes) !== hash)
          invalid(`The bytes uploaded for "${path}" do not match its hash ${hash}.`);
        put(path, bytes, contentType, true);
        continue;
      }
      if (write.base64 !== undefined) {
        put(path, new Uint8Array(Buffer.from(write.base64, 'base64')), contentType);
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
      readFrom(path);
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
      readFrom(path);
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
      upserts.filter((file) => !file.stored),
      (file) =>
        this.deps.store.write(
          artboardBlobKey(artboardId, file.hash),
          file.bytes!,
          file.contentType,
        ),
      { concurrency: BLOB_CONCURRENCY },
    );

    return {
      basis,
      changed: upserts.map(({ hash, path, size }) => ({ hash, path, size })),
      deletes,
      upserts,
    };
  }

  /**
   * Write the prepared rows. Locks the artboard row first, so concurrent commits on one artboard
   * apply one at a time; an edit or delete whose file changed since prepare() read it fails with
   * `conflict` instead of silently overwriting the other write.
   */
  async commit(
    artboardId: string,
    prepared: PreparedArtboardFiles,
    tx: Transaction,
  ): Promise<ArtboardCommittedFiles> {
    const model = this.model.withTransaction(tx);
    if (!(await model.lockArtboard(artboardId)))
      throw new ArtboardServiceError('not_found', `Artboard "${artboardId}" was not found.`);
    const current = new Map((await model.list(artboardId)).map((row) => [row.path, row.hash]));
    for (const [path, hash] of prepared.basis)
      if (current.get(path) !== hash)
        throw new ArtboardServiceError(
          'conflict',
          `"${path}" changed since it was read. Read the file again, then retry the change.`,
        );

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
    const paths = new Set(current.keys());
    const touched = new Set(prepared.deletes);
    for (const { hash, path } of prepared.upserts) {
      if (current.get(path) !== hash) touched.add(path);
      paths.add(path);
    }
    for (const path of prepared.deletes) paths.delete(path);
    return { paths, touched };
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
