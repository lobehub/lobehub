import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type {
  LocalAsrModelPackId,
  LocalAsrModelPackState,
  LocalAsrModelPackStatus,
  LocalAsrModelProgressPayload,
} from '@lobechat/electron-client-ipc';

import {
  getModelPack,
  getPackSize,
  LOCAL_ASR_MODEL_PACKS,
  type LocalAsrModelFile,
  type LocalAsrModelPack,
} from './catalog';

const MANIFEST_FILE = 'verified.json';
const PROGRESS_INTERVAL_MS = 250;

type Manifest = Record<string, string>;

export class ModelChecksumError extends Error {
  constructor(readonly file: string) {
    super(`checksum_mismatch:${file}`);
    this.name = 'ModelChecksumError';
  }
}

interface ModelManagerOptions {
  dir: string;
  fetcher?: typeof fetch;
  onProgress?: (payload: LocalAsrModelProgressPayload) => void;
  packs?: LocalAsrModelPack[];
}

const sizeOf = async (filePath: string) => {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
};

const updateHashFromFile = async (hash: Hash, filePath: string) => {
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
};

export const hashFile = async (filePath: string) => {
  const hash = createHash('sha256');
  await updateHashFromFile(hash, filePath);
  return hash.digest('hex');
};

/**
 * Downloads, verifies and deletes the local ASR model files under
 * `<userData>/models/local-asr`. A file only counts as installed after its
 * SHA-256 matched the catalog; partial downloads are kept as `.part` and resumed.
 */
export class LocalAsrModelManager {
  private readonly dir: string;
  private readonly fetcher: typeof fetch;
  private readonly onProgress?: (payload: LocalAsrModelProgressPayload) => void;
  private readonly packs: LocalAsrModelPack[];
  private readonly active = new Map<LocalAsrModelPackId, AbortController>();
  private readonly errors = new Map<LocalAsrModelPackId, string>();
  private readonly verifying = new Set<LocalAsrModelPackId>();

  constructor(options: ModelManagerOptions) {
    this.dir = options.dir;
    this.fetcher = options.fetcher ?? fetch;
    this.onProgress = options.onProgress;
    this.packs = options.packs ?? LOCAL_ASR_MODEL_PACKS;
  }

  get modelDir() {
    return this.dir;
  }

  filePath(name: string) {
    return path.join(this.dir, name);
  }

  async getPackStates(): Promise<LocalAsrModelPackState[]> {
    const manifest = await this.readManifest();
    return Promise.all(this.packs.map((pack) => this.getPackState(pack, manifest)));
  }

  async isPackReady(id: LocalAsrModelPackId) {
    const manifest = await this.readManifest();
    const state = await this.getPackState(this.getPack(id), manifest);
    return state.status === 'ready';
  }

  /** Absolute paths of a ready pack's files, keyed by catalog file name. */
  async getReadyPaths(id: LocalAsrModelPackId): Promise<Record<string, string> | undefined> {
    if (!(await this.isPackReady(id))) return undefined;
    return Object.fromEntries(
      this.getPack(id).files.map((file) => [file.name, this.filePath(file.name)]),
    );
  }

  isDownloading(id: LocalAsrModelPackId) {
    return this.active.has(id);
  }

  /** Download every missing file of a pack. Resolves when done, cancelled or failed. */
  async download(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    const pack = this.getPack(id);
    if (this.active.has(id)) return this.getPackState(pack, await this.readManifest());

    const controller = new AbortController();
    this.active.set(id, controller);
    this.errors.delete(id);
    await mkdir(this.dir, { recursive: true });

    const totalBytes = getPackSize(pack);
    try {
      let doneBytes = 0;
      for (const file of pack.files) {
        const manifest = await this.readManifest();
        if (
          manifest[file.name] === file.sha256 &&
          (await sizeOf(this.filePath(file.name))) === file.size
        ) {
          doneBytes += file.size;
          continue;
        }
        await this.downloadFile(pack, file, doneBytes, totalBytes, controller.signal);
        doneBytes += file.size;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit({ downloadedBytes: 0, id, status: 'not_downloaded', totalBytes });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.errors.set(id, message);
        this.emit({ downloadedBytes: 0, error: message, id, status: 'corrupted', totalBytes });
      }
    } finally {
      this.active.delete(id);
    }

    const state = await this.getPackState(pack, await this.readManifest());
    if (state.status === 'ready') {
      this.emit({ downloadedBytes: totalBytes, id, status: 'ready', totalBytes });
    }
    return state;
  }

  cancel(id: LocalAsrModelPackId) {
    this.active.get(id)?.abort();
  }

  /** Re-hash every installed file of a pack against the catalog. */
  async verify(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    const pack = this.getPack(id);
    const totalBytes = getPackSize(pack);
    this.verifying.add(id);
    this.emit({ downloadedBytes: 0, id, status: 'verifying', totalBytes });
    try {
      const manifest = await this.readManifest();
      let checked = 0;
      for (const file of pack.files) {
        const filePath = this.filePath(file.name);
        delete manifest[file.name];
        if ((await sizeOf(filePath)) === file.size) {
          this.emit({
            downloadedBytes: checked,
            file: file.name,
            id,
            status: 'verifying',
            totalBytes,
          });
          if ((await hashFile(filePath)) === file.sha256) manifest[file.name] = file.sha256;
        }
        checked += file.size;
      }
      await this.writeManifest(manifest);
    } finally {
      this.verifying.delete(id);
    }

    const state = await this.getPackState(pack, await this.readManifest());
    this.emit({
      downloadedBytes: state.downloadedBytes,
      id,
      status: state.status,
      totalBytes,
    });
    return state;
  }

  async delete(id: LocalAsrModelPackId): Promise<LocalAsrModelPackState> {
    const pack = this.getPack(id);
    this.cancel(id);
    const manifest = await this.readManifest();
    for (const file of pack.files) {
      delete manifest[file.name];
      await rm(this.filePath(file.name), { force: true });
      await rm(`${this.filePath(file.name)}.part`, { force: true });
    }
    await this.writeManifest(manifest);
    this.errors.delete(id);

    const state = await this.getPackState(pack, manifest);
    this.emit({ downloadedBytes: 0, id, status: state.status, totalBytes: state.totalBytes });
    return state;
  }

  private getPack(id: LocalAsrModelPackId) {
    return this.packs.find((pack) => pack.id === id) ?? getModelPack(id);
  }

  private async getPackState(
    pack: LocalAsrModelPack,
    manifest: Manifest,
  ): Promise<LocalAsrModelPackState> {
    let downloadedBytes = 0;
    let verified = 0;
    let corrupted = false;
    const files = await Promise.all(
      pack.files.map(async (file) => {
        const finalSize = await sizeOf(this.filePath(file.name));
        const partSize = finalSize ? 0 : await sizeOf(`${this.filePath(file.name)}.part`);
        const size = finalSize || partSize;
        if (finalSize) {
          if (finalSize === file.size && manifest[file.name] === file.sha256) verified += 1;
          else corrupted = true;
        }
        downloadedBytes += Math.min(size, file.size);
        return { downloadedBytes: size, name: file.name, sha256: file.sha256, size: file.size };
      }),
    );

    let status: LocalAsrModelPackStatus = 'not_downloaded';
    if (this.verifying.has(pack.id)) status = 'verifying';
    else if (this.active.has(pack.id)) status = 'downloading';
    else if (verified === pack.files.length) status = 'ready';
    else if (corrupted || this.errors.has(pack.id)) status = 'corrupted';

    return {
      description: pack.description,
      downloadedBytes,
      error: this.errors.get(pack.id),
      files,
      id: pack.id,
      required: pack.required,
      status,
      totalBytes: getPackSize(pack),
    };
  }

  private async downloadFile(
    pack: LocalAsrModelPack,
    file: LocalAsrModelFile,
    baseBytes: number,
    totalBytes: number,
    signal: AbortSignal,
  ) {
    const target = this.filePath(file.name);
    const partPath = `${target}.part`;
    await rm(target, { force: true });

    let lastError: unknown;
    for (const url of file.urls) {
      if (signal.aborted) throw signal.reason;
      try {
        await this.fetchToPart(pack, file, url, partPath, baseBytes, totalBytes, signal);
        lastError = undefined;
        break;
      } catch (error) {
        if (signal.aborted || error instanceof ModelChecksumError) throw error;
        lastError = error;
      }
    }
    if (lastError) throw lastError;

    await rename(partPath, target);
    const manifest = await this.readManifest();
    manifest[file.name] = file.sha256;
    await this.writeManifest(manifest);
  }

  private async fetchToPart(
    pack: LocalAsrModelPack,
    file: LocalAsrModelFile,
    url: string,
    partPath: string,
    baseBytes: number,
    totalBytes: number,
    signal: AbortSignal,
  ) {
    let offset = await sizeOf(partPath);
    if (offset >= file.size) {
      await rm(partPath, { force: true });
      offset = 0;
    }

    const response = await this.fetcher(url, {
      headers: offset ? { Range: `bytes=${offset}-` } : undefined,
      redirect: 'follow',
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`download_failed:${response.status}:${file.name}`);
    }

    // Servers that ignore Range answer 200 with the full body: start over.
    const resumed = offset > 0 && response.status === 206;
    if (!resumed) offset = 0;

    const hash = createHash('sha256');
    if (resumed) {
      await updateHashFromFile(hash, partPath);
    }

    let received = offset;
    let lastEmit = 0;
    const startedAt = Date.now();
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now;
          const elapsed = Math.max(1, now - startedAt) / 1000;
          this.emit({
            downloadedBytes: baseBytes + received,
            file: file.name,
            id: pack.id,
            speed: Math.round((received - offset) / elapsed),
            status: 'downloading',
            totalBytes,
          });
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as any),
      meter,
      createWriteStream(partPath, { flags: resumed ? 'a' : 'w' }),
      { signal },
    );

    if (received !== file.size || hash.digest('hex') !== file.sha256) {
      await rm(partPath, { force: true });
      throw new ModelChecksumError(file.name);
    }
  }

  private emit(payload: LocalAsrModelProgressPayload) {
    this.onProgress?.(payload);
  }

  /** Copies only catalog file names with string hashes into a null-prototype record. */
  private async readManifest(): Promise<Manifest> {
    const manifest: Manifest = Object.create(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(this.dir, MANIFEST_FILE), 'utf8'));
    } catch {
      return manifest;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return manifest;

    const known = new Set(this.packs.flatMap((pack) => pack.files.map((file) => file.name)));
    for (const [name, hash] of Object.entries(parsed)) {
      if (known.has(name) && typeof hash === 'string') manifest[name] = hash;
    }
    return manifest;
  }

  private async writeManifest(manifest: Manifest) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  }
}
