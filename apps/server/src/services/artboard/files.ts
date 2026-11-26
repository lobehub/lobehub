import {
  ARTBOARD_FILE_LIMITS,
  artboardFileContentType,
  isArtboardImagePath,
  isArtboardTextPath,
  normalizeArtboardFilePath,
} from '@lobechat/types';
import pMap from 'p-map';

import type { ArtboardFileModel, ArtboardStoredFile } from '@/database/models/artboardFile';
import type { FileService } from '@/server/services/file';

import { ArtboardServiceError } from './errors';

export interface ArtboardBlobUpload {
  headers?: Record<string, string>;
  url: string;
}

export interface ArtboardStoredObject {
  /** Object ETag without quotes; changes whenever the content does. */
  etag: string;
  key: string;
  size: number;
}

export interface ArtboardBlobStore {
  delete: (keys: string[]) => Promise<void>;
  list: (prefix: string) => Promise<ArtboardStoredObject[]>;
  /** A signed PUT the client uploads one file to, for files too large for a request body. */
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
    list: (prefix) => service().listFileObjects(prefix),
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

/** A Canvas to copy in; without `version`, its latest one. */
export interface ArtboardImportSource {
  canvasId: string;
  version?: number;
}

type Only<K extends string> = {
  [P in Exclude<'base64' | 'content' | 'fileRef' | 'fromCanvas' | 'uploaded', K>]?: never;
};

export type ArtboardFileWrite =
  | (Only<'content'> & { content: string; path: string })
  | (Only<'fileRef'> & { fileRef: string; path: string })
  | (Only<'base64'> & { base64: string; path: string })
  /** Already PUT to the URL from prepareUploads; the write only records the change. */
  | (Only<'uploaded'> & { path: string; uploaded: true })
  /** A copy of a Canvas page: it does not follow the Canvas afterwards. */
  | (Only<'fromCanvas'> & { fromCanvas: ArtboardImportSource; path: string });

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

export interface ArtboardFileEntry {
  contentType: string;
  /** The object's ETag. */
  hash: string;
  path: string;
  size: number;
}

export interface ArtboardFileContent {
  bytes: Uint8Array;
  content?: string;
  contentType: string;
  path: string;
}

export interface ArtboardFileUploadRequest {
  path: string;
  size: number;
}

export interface ArtboardImportedPage {
  /** Files the entry loads, by path relative to the entry's directory. */
  assets: { bytes: Uint8Array; path: string }[];
  entry: Uint8Array;
}

interface ArtboardFileServiceDeps {
  resolveImage: (fileRef: string) => Promise<ArtboardImageBytes | undefined>;
  /**
   * A copy of a Canvas or Work version: its HTML entry plus the files it loads by relative path.
   * Undefined when it does not exist, has no HTML, or the user cannot read it.
   */
  resolveImport: (source: ArtboardImportSource) => Promise<ArtboardImportedPage | undefined>;
  store: ArtboardBlobStore;
  usage?: ArtboardFileUsage;
}

export interface ArtboardFileUsage {
  record: (artboardId: string, stored: ArtboardStoredFile[], deleted: string[]) => Promise<void>;
  removeAll: (artboardId: string) => Promise<void>;
}

export const artboardFileUsage = (model: ArtboardFileModel): ArtboardFileUsage => ({
  record: (artboardId, stored, deleted) => model.record(artboardId, stored, deleted),
  removeAll: (artboardId) => model.deleteByArtboards([artboardId]),
});

/** What a set of changes will write and delete, checked against the limits but not yet stored. */
export interface ArtboardFilePlan {
  deletes: string[];
  sizes: Map<string, number>;
  /** Paths already uploaded through a signed URL. */
  uploaded: string[];
  writes: Map<string, Uint8Array>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const invalid = (message: string): never => {
  throw new ArtboardServiceError('invalid', message);
};

const artboardStoragePrefix = (artboardId: string) => `artboards/${artboardId}/`;

export const removeArtboardFiles = async (store: ArtboardBlobStore, artboardId: string) => {
  const objects = await store.list(artboardStoragePrefix(artboardId));
  if (objects.length) await store.delete(objects.map((object) => object.key));
};

export const artboardFilesPrefix = (artboardId: string) =>
  `${artboardStoragePrefix(artboardId)}files/`;

export const artboardFileKey = (artboardId: string, path: string) =>
  `${artboardFilesPrefix(artboardId)}${path}`;

const requirePath = (path: string) =>
  normalizeArtboardFilePath(path) ??
  invalid(
    `"${path}" is not a valid artboard file path: use a relative path (no "..") of letters, digits and -_.@ ending in a known extension (html, css, js, json, svg, png, jpg, webp, gif, woff2…).`,
  );

const sizeLimitOf = (path: string) =>
  isArtboardImagePath(path)
    ? ARTBOARD_FILE_LIMITS.maxImageBytes
    : ARTBOARD_FILE_LIMITS.maxTextFileBytes;

const assertSize = (path: string, size: number) => {
  if (size > sizeLimitOf(path))
    invalid(`"${path}" is ${size} bytes; the limit is ${sizeLimitOf(path)}.`);
};

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

/**
 * An artboard's files are a plain folder in object storage, keyed by path. Nothing ties them to
 * the boards: a board may point at a path that is not written yet, and a file may be deleted while
 * a board still shows it.
 */
export class ArtboardFileService {
  constructor(private deps: ArtboardFileServiceDeps) {}

  async list(artboardId: string): Promise<ArtboardFileEntry[]> {
    const prefix = artboardFilesPrefix(artboardId);
    const objects = await this.deps.store.list(prefix);
    return objects.flatMap(({ etag, key, size }) => {
      const path = normalizeArtboardFilePath(key.slice(prefix.length));
      const contentType = path && artboardFileContentType(path);
      return path && contentType ? [{ contentType, hash: etag, path, size }] : [];
    });
  }

  async read(artboardId: string, path: string): Promise<ArtboardFileContent> {
    const normalized = requirePath(path);
    const bytes = await this.deps.store.read(artboardFileKey(artboardId, normalized)).catch(() => {
      throw new ArtboardServiceError(
        'not_found',
        `Artboard "${artboardId}" has no file "${normalized}".`,
      );
    });
    return {
      bytes,
      ...(isArtboardTextPath(normalized) ? { content: decoder.decode(bytes) } : {}),
      contentType: artboardFileContentType(normalized)!,
      path: normalized,
    };
  }

  /** Validate the changes and compute every file they write. Stores nothing. */
  async prepare(artboardId: string, changes: ArtboardFileChanges): Promise<ArtboardFilePlan> {
    const existing = new Map((await this.list(artboardId)).map((file) => [file.path, file.size]));
    const sizes = new Map(existing);
    const writes = new Map<string, Uint8Array>();
    const uploaded: string[] = [];
    const deletes: string[] = [];

    const put = (path: string, bytes: Uint8Array) => {
      assertSize(path, bytes.byteLength);
      writes.set(path, bytes);
      sizes.set(path, bytes.byteLength);
    };

    for (const write of changes.writes ?? []) {
      const path = requirePath(write.path);
      if (write.uploaded) {
        if (!existing.has(path))
          invalid(
            `"${path}" was not uploaded: get a URL from prepareFileUploads and PUT the file first.`,
          );
        assertSize(path, existing.get(path)!);
        uploaded.push(path);
        continue;
      }
      if (write.fileRef !== undefined) {
        if (!isArtboardImagePath(path))
          invalid(`"${path}" takes text content; only image paths can be written from a fileRef.`);
        const image = await this.deps.resolveImage(write.fileRef);
        if (!image)
          throw new ArtboardServiceError(
            'source_denied',
            `fileRef "${write.fileRef}" does not match an image you can access. Use a file id from <file id> or an image ref from <image ref> in this conversation.`,
          );
        put(path, image.bytes);
        continue;
      }
      if (write.fromCanvas !== undefined) {
        const page = await this.deps.resolveImport(write.fromCanvas);
        if (!page)
          throw new ArtboardServiceError(
            'source_denied',
            `Canvas "${write.fromCanvas.canvasId}" was not found, cannot be read, or this server has no Canvas runtime to bundle it with.`,
          );
        put(path, page.entry);
        // Assets sit next to the page so its relative references keep working.
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        for (const asset of page.assets) put(requirePath(`${dir}${asset.path}`), asset.bytes);
        continue;
      }
      if (write.base64 !== undefined) {
        put(path, new Uint8Array(Buffer.from(write.base64, 'base64')));
        continue;
      }
      if (!isArtboardTextPath(path))
        invalid(`"${path}" is binary; write it from a fileRef or base64 instead of text content.`);
      put(path, encoder.encode(write.content ?? ''));
    }

    for (const change of changes.edits ?? []) {
      const path = requirePath(change.path);
      if (!isArtboardTextPath(path)) invalid(`"${path}" is not a text file and cannot be edited.`);
      const pending = writes.get(path);
      if (!pending && !existing.has(path)) invalid(`Artboard has no file "${path}" to edit.`);
      const text = decoder.decode(
        pending ?? (await this.deps.store.read(artboardFileKey(artboardId, path))),
      );
      const count = countOccurrences(text, change.oldText);
      if (count !== 1)
        invalid(
          count === 0
            ? `The text to replace was not found in "${path}". Read the file and copy the exact text.`
            : `The text to replace appears ${count} times in "${path}"; include more surrounding text so it appears once.`,
        );
      put(path, encoder.encode(text.replace(change.oldText, () => change.newText)));
    }

    for (const raw of changes.deletes ?? []) {
      const path = requirePath(raw);
      writes.delete(path);
      sizes.delete(path);
      deletes.push(path);
    }

    if (sizes.size > ARTBOARD_FILE_LIMITS.maxFiles)
      invalid(
        `An artboard holds at most ${ARTBOARD_FILE_LIMITS.maxFiles} files; this would make ${sizes.size}.`,
      );
    const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    if (total > ARTBOARD_FILE_LIMITS.maxTotalBytes)
      invalid(
        `The artboard's files would total ${total} bytes; the limit is ${ARTBOARD_FILE_LIMITS.maxTotalBytes}.`,
      );

    return { deletes, sizes, uploaded, writes };
  }

  /** Every path a plan changes or deletes. */
  static touched = (plan: ArtboardFilePlan) => [
    ...plan.writes.keys(),
    ...plan.uploaded,
    ...plan.deletes,
  ];

  async apply(artboardId: string, plan: ArtboardFilePlan): Promise<string[]> {
    await pMap(
      [...plan.writes],
      ([path, bytes]) =>
        this.deps.store.write(
          artboardFileKey(artboardId, path),
          bytes,
          artboardFileContentType(path)!,
        ),
      { concurrency: BLOB_CONCURRENCY },
    );
    if (plan.deletes.length)
      await this.deps.store.delete(plan.deletes.map((path) => artboardFileKey(artboardId, path)));
    const stored = [...plan.writes.keys(), ...plan.uploaded];
    await this.deps.usage?.record(
      artboardId,
      stored.map((path) => ({
        contentType: artboardFileContentType(path)!,
        key: artboardFileKey(artboardId, path),
        path,
        size: plan.sizes.get(path) ?? 0,
      })),
      plan.deletes,
    );
    return stored;
  }

  async applyChanges(artboardId: string, changes: ArtboardFileChanges) {
    return this.apply(artboardId, await this.prepare(artboardId, changes));
  }

  /** Signed PUT URLs, one per path, for files too large to send in a request body. */
  async prepareUploads(
    artboardId: string,
    requests: ArtboardFileUploadRequest[],
  ): Promise<{ uploads: (ArtboardBlobUpload & { path: string })[] }> {
    const paths = requests.map((request) => {
      const path = requirePath(request.path);
      assertSize(path, request.size);
      return path;
    });
    const uploads = await pMap(
      paths,
      async (path) => ({
        path,
        ...(await this.deps.store.presignWrite(artboardFileKey(artboardId, path))),
      }),
      { concurrency: BLOB_CONCURRENCY },
    );
    return { uploads };
  }

  async removeAll(artboardId: string) {
    await removeArtboardFiles(this.deps.store, artboardId);
    await this.deps.usage?.removeAll(artboardId);
  }
}
