import { createHash } from 'node:crypto';

import {
  CANVAS_ENTRY,
  CANVAS_RUNTIME_MAJOR,
  type CanvasIssue,
  type CanvasManifest,
  type CanvasProjectFile,
  type CanvasProjectSnapshot,
  getCanvasContentType,
  isCanvasTextPath,
  normalizeCanvasPath,
  validateCanvasProject,
} from '@lobechat/canvas';
import { checkCanvasMermaid } from '@lobechat/canvas/mermaid';
import type { CanvasWorkVersionMetadata } from '@lobechat/types';
import pMap from 'p-map';

import type { CanvasStorageQuotaResult } from '@/business/server/canvasStorage';
import { CanvasFileModel } from '@/database/models/canvasFile';
import { WorkModel } from '@/database/models/work';
import { CanvasFileRepository } from '@/database/repositories/canvasFile';
import type { LobeChatDatabase } from '@/database/type';

export interface CanvasBlobStore {
  delete: (keys: string[]) => Promise<void>;
  read: (key: string) => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
}

export type CanvasCommitFile = CanvasProjectFile & { hash?: string };

export type CanvasCommitResult =
  | { issues: CanvasIssue[]; ok: false }
  | { manifest: CanvasManifest; metadata: CanvasWorkVersionMetadata; ok: true };

interface CanvasStorageDeps {
  checkQuota?: (params: {
    addedBytes: number;
    userId: string;
    workspaceId?: string | null;
  }) => Promise<CanvasStorageQuotaResult>;
  db: LobeChatDatabase;
  store: CanvasBlobStore;
  userId: string;
  workspaceId?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const toBytes = (content: string | Uint8Array) =>
  typeof content === 'string' ? encoder.encode(content) : content;

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const isOwnCanvasManifestKey = (userId: string, key: string) =>
  key.startsWith(`canvas/${userId}/`) && !key.includes('..');

const BLOB_READ_CONCURRENCY = 8;

export class CanvasStorageService {
  private deps: CanvasStorageDeps;
  private files: CanvasFileModel;
  private fileRegistry: CanvasFileRepository;

  constructor(deps: CanvasStorageDeps) {
    this.deps = deps;
    this.files = new CanvasFileModel(deps.db, deps.userId, deps.workspaceId);
    this.fileRegistry = new CanvasFileRepository(deps.db, deps.userId, deps.workspaceId);
  }

  get ownerId() {
    return this.deps.userId;
  }

  private get prefix() {
    return `canvas/${this.deps.userId}/`;
  }

  private blobKey(hash: string) {
    return `${this.prefix}blobs/${hash}`;
  }

  ownsKey(key: string) {
    return isOwnCanvasManifestKey(this.deps.userId, key);
  }

  async readManifest(key: string): Promise<CanvasManifest> {
    if (!this.ownsKey(key)) throw new Error('Canvas manifest is not owned by the current user');
    return JSON.parse(decoder.decode(await this.deps.store.read(key))) as CanvasManifest;
  }

  async readFile(manifest: CanvasManifest, path: string) {
    const normalized = normalizeCanvasPath(path);
    const entry = normalized ? manifest.files[normalized] : undefined;
    if (!entry) return;

    return {
      bytes: await this.deps.store.read(this.blobKey(entry.hash)),
      contentType: entry.contentType,
    };
  }

  async readSnapshot(key: string): Promise<CanvasProjectSnapshot> {
    const manifest = await this.readManifest(key);
    const files = await pMap(
      Object.keys(manifest.files),
      async (path) => {
        const file = await this.readFile(manifest, path);
        if (!file) throw new Error(`Canvas file ${path} is missing`);
        const text = isCanvasTextPath(path);
        return {
          content: text ? decoder.decode(file.bytes) : Buffer.from(file.bytes).toString('base64'),
          contentType: file.contentType,
          encoding: text ? ('utf8' as const) : ('base64' as const),
          path,
        };
      },
      { concurrency: BLOB_READ_CONCURRENCY },
    );
    return { entry: manifest.entry, files };
  }

  async loadProject(manifest: CanvasManifest): Promise<Map<string, CanvasCommitFile>> {
    const entries = await pMap(
      Object.entries(manifest.files),
      async ([path, entry]): Promise<[string, CanvasCommitFile]> => {
        if (!isCanvasTextPath(path)) {
          return [path, { content: new Uint8Array(0), hash: entry.hash, path, size: entry.size }];
        }
        const bytes = await this.deps.store.read(this.blobKey(entry.hash));
        return [path, { content: decoder.decode(bytes), path }];
      },
      { concurrency: BLOB_READ_CONCURRENCY },
    );
    return new Map(entries);
  }

  async commit(canvasId: string, input: CanvasCommitFile[]): Promise<CanvasCommitResult> {
    const validation = validateCanvasProject(input, { checkMermaid: checkCanvasMermaid });
    if (!validation.ok) return { issues: validation.issues, ok: false };

    const files = input.map((file) => {
      const path = normalizeCanvasPath(file.path)!;
      if (file.hash && file.size !== undefined) {
        return {
          bytes: undefined,
          contentType: getCanvasContentType(path),
          hash: file.hash,
          path,
          size: file.size,
        };
      }
      const bytes = toBytes(file.content);
      return {
        bytes,
        contentType: getCanvasContentType(path),
        hash: sha256(bytes),
        path,
        size: bytes.byteLength,
      };
    });

    const known = await this.files.listByHashes([...new Set(files.map((file) => file.hash))]);
    const inThisCanvas = new Set(
      known.filter((row) => row.canvasId === canvasId).map((row) => row.fileHash),
    );
    const uploaded = new Set(known.map((row) => row.fileHash));

    const added = new Map<string, (typeof files)[number]>();
    for (const file of files) if (!inThisCanvas.has(file.hash)) added.set(file.hash, file);

    const addedBytes = [...added.values()].reduce((sum, file) => sum + file.size, 0);
    if (addedBytes > 0 && this.deps.checkQuota) {
      const quota = await this.deps.checkQuota({
        addedBytes,
        userId: this.deps.userId,
        workspaceId: this.deps.workspaceId,
      });
      if (!quota.ok)
        return { issues: [{ message: quota.message, rule: 'quota-exceeded' }], ok: false };
    }

    for (const file of added.values()) {
      if (uploaded.has(file.hash)) continue;
      if (!file.bytes) throw new Error(`Canvas blob ${file.hash} for ${file.path} is missing`);
      await this.deps.store.write(this.blobKey(file.hash), file.bytes, file.contentType);
      uploaded.add(file.hash);
    }

    await this.fileRegistry.register(
      canvasId,
      [...added.values()].map((file) => ({
        contentType: file.contentType,
        hash: file.hash,
        name: basename(file.path),
        size: file.size,
        url: this.blobKey(file.hash),
      })),
    );

    const manifest: CanvasManifest = {
      entry: CANVAS_ENTRY,
      files: Object.fromEntries(
        files
          .toSorted((a, b) => a.path.localeCompare(b.path))
          .map((file) => [
            file.path,
            { contentType: file.contentType, hash: file.hash, size: file.size },
          ]),
      ),
      runtimeMajor: CANVAS_RUNTIME_MAJOR,
      schemaVersion: 1,
    };
    const manifestBytes = encoder.encode(JSON.stringify(manifest));
    const manifestKey = `${this.prefix}${canvasId}/manifests/${sha256(manifestBytes)}.json`;
    await this.deps.store.write(manifestKey, manifestBytes, 'application/json');

    return {
      manifest,
      metadata: {
        entry: CANVAS_ENTRY,
        fileCount: files.length,
        manifestKey,
        runtimeMajor: CANVAS_RUNTIME_MAJOR,
        totalSize: files.reduce((sum, file) => sum + file.size, 0),
      },
      ok: true,
    };
  }

  async removeCanvas(canvasId: string, manifestKeys: string[]) {
    const orphaned = await this.files.deleteByCanvas(canvasId);
    const referenced = new Set(
      await new WorkModel(this.deps.db, this.deps.userId).findReferencedCanvasManifestKeys(
        manifestKeys,
      ),
    );
    const keys = [
      ...orphaned,
      ...manifestKeys.filter(
        (key) =>
          this.ownsKey(key) &&
          key.startsWith(`${this.prefix}${canvasId}/manifests/`) &&
          !referenced.has(key),
      ),
    ];
    if (keys.length > 0) await this.deps.store.delete(keys);
  }
}
