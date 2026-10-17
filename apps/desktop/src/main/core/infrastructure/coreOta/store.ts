import { existsSync } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

import { unzip } from 'fflate';

import { createLogger } from '@/utils/logger';

import { type CoreManifest, findMissingEntryAssets, sha256File } from './manifest';
import { PackDownloader, type PackFetch } from './pack';
import { isRendererPath, treeRendererSource } from './rendererSource';
import { applyZstdPatch } from './zstdPatch';

const logger = createLogger('core:CoreStore');

type FetchImpl = PackFetch;
type LocalCore = { dir: string; manifest: CoreManifest };
type StageInput = {
  builtin: LocalCore;
  current: LocalCore | null;
  onApplying?: () => void;
  onDownloadProgress?: (progress: { received: number; total?: number }) => void;
  objectsBaseUrl?: string;
  packsBaseUrl: string;
  remote: CoreManifest;
};
type StageResult = {
  dir: string;
  downloaded: { bytes: number; objects: number; patches: number };
  fallbackFull: boolean;
};

const ENTRY_HTMLS = ['index.html', 'overlay.html', 'popup.html'].map(
  (name) => `apps/desktop/${name}`,
);
const FULL_FALLBACK_THRESHOLD = 400;
const CONCURRENCY = 8;
const PACK_ENTRY = /^objects\/([0-9a-f]{64})$/;
const DIR_MODE = 0o700;
export const SAFE_VERSION = /^[\w.+-]{1,64}$/;

const zstdDecompressAsync = promisify(zstdDecompress);

// Settles every lane before rethrowing so callers' cleanup never races in-flight writes.
const runPool = async <T>(items: T[], worker: (item: T) => Promise<void>) => {
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      try {
        await worker(items[next++]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane),
  );
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
};

const attempt = (label: string, task: () => Promise<void>) =>
  task().then(
    () => true,
    (error) => {
      logger.warn(`Core OTA ${label} failed`, error);
      return false;
    },
  );

const resolveInside = (root: string, relPath: string): string => {
  const target = path.join(root, relPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Tree path resolves outside target dir: ${relPath}`);
  }
  return target;
};

const readDirNames = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const isSafeVersion = (version: string): boolean =>
  SAFE_VERSION.test(version) && version !== '.' && version !== '..';

// An OTA version dir holds no renderer files, so indexing them would shadow the builtin copies.
export const indexLocal = (
  coreDir: string,
  manifest: CoreManifest,
  { skipRenderer = false } = {},
): Map<string, string> =>
  new Map(
    manifest.tree
      .filter((file) => !skipRenderer || !isRendererPath(file.path))
      .map((file) => [file.sha256, path.join(coreDir, file.path)]),
  );

export const decodeCorePack = (content: Buffer): Promise<Map<string, Buffer>> =>
  new Promise((resolve, reject) => {
    unzip(new Uint8Array(content), (error, unpacked) => {
      if (error) return reject(error);
      const entries = new Map<string, Buffer>();
      for (const [name, raw] of Object.entries(unpacked)) {
        const sha256 = PACK_ENTRY.exec(name)?.[1];
        const value = Buffer.from(raw);
        if (!sha256 || sha256File(value) !== sha256) {
          return reject(new Error(`Core pack entry invalid: ${name}`));
        }
        entries.set(sha256, value);
      }
      resolve(entries);
    });
  });

export const cleanupLegacy = async (userData: string) => {
  for (const name of ['renderer-ota-v2', 'renderer-ota']) {
    await rm(path.join(userData, name), { force: true, recursive: true });
  }
};

export class CoreStore {
  private active = false;
  private readonly packDownloader: PackDownloader;
  private readonly storeDir: string;
  private readonly coresDir: string;

  constructor(
    private readonly otaRoot: string,
    private readonly fetchImpl: FetchImpl,
  ) {
    this.packDownloader = new PackDownloader(fetchImpl);
    this.storeDir = path.join(otaRoot, 'store');
    this.coresDir = path.join(otaRoot, 'cores');
  }

  async stage(input: StageInput) {
    if (this.active) throw new Error('Core staging already active');
    this.active = true;
    try {
      return await this.stageCore(input);
    } finally {
      this.active = false;
    }
  }

  private async stageCore({
    builtin,
    current,
    objectsBaseUrl,
    packsBaseUrl,
    remote,
    onApplying,
    onDownloadProgress,
  }: StageInput) {
    let received = 0;
    let total: number | undefined;
    const onChunk = onDownloadProgress
      ? (bytes: number) => {
          received += bytes;
          onDownloadProgress({ received, total });
        }
      : undefined;
    if (!isSafeVersion(remote.version)) throw new Error(`Unsafe version: ${remote.version}`);
    await mkdir(this.storeDir, { mode: DIR_MODE, recursive: true });
    await mkdir(this.coresDir, { mode: DIR_MODE, recursive: true });

    const byHash = new Map([
      ...indexLocal(builtin.dir, builtin.manifest),
      ...(current ? indexLocal(current.dir, current.manifest, { skipRenderer: true }) : []),
    ]);
    if (remote.schemaVersion === 4) {
      const expected = new Set([
        ...remote.tree.map((file) => file.sha256),
        ...remote.patches.map((patch) => patch.fromSha256),
      ]);
      await runPool([...expected], async (hash) => {
        const candidates = [byHash.get(hash), this.objectPath(hash)].filter(
          (file): file is string => !!file,
        );
        byHash.delete(hash);
        for (const source of candidates) {
          try {
            if ((await stat(source)).size > 256 * 1024 ** 2) continue;
            if (sha256File(await readFile(source)) === hash) {
              byHash.set(hash, source);
              break;
            }
          } catch {
            /* Missing local content is fetched from the target pack. */
          }
        }
      });
      const missing = [...new Set(remote.tree.map((file) => file.sha256))].filter(
        (hash) => !byHash.has(hash),
      );
      const result = await this.packDownloader.download(
        remote,
        missing,
        byHash,
        packsBaseUrl,
        (hash, bytes) => this.putObject(hash, bytes),
        onChunk,
      );
      onApplying?.();
      return { ...result, dir: await this.assemble(remote, byHash, builtin) } satisfies StageResult;
    }
    const missing = [...new Set(remote.tree.map((file) => file.sha256))].filter(
      (sha256) => !byHash.has(sha256) && !existsSync(this.objectPath(sha256)),
    );
    const downloaded = { bytes: 0, objects: 0, patches: 0 };
    const failed: string[] = [];

    if (missing.length <= FULL_FALLBACK_THRESHOLD) {
      const patches = new Map(
        remote.patches
          .filter((patch) => byHash.has(patch.fromSha256))
          .map((patch) => [patch.toSha256, patch]),
      );
      await runPool(missing, async (sha256) => {
        const patch = patches.get(sha256);
        const patched =
          patch &&
          (await attempt(`patch ${patch.fromSha256}->${patch.toSha256}`, async () => {
            const url = `${objectsBaseUrl}/patches/${patch.fromSha256}-${patch.toSha256}.zst`;
            const raw = await this.fetchBytes(url, onChunk);
            const base = await readFile(byHash.get(patch.fromSha256)!);
            await this.putObject(sha256, await applyZstdPatch(base, raw));
            downloaded.patches += 1;
            downloaded.bytes += raw.byteLength;
          }));
        if (patched) return;
        const fetched = await attempt(`object ${sha256}`, async () => {
          const raw = await this.fetchBytes(`${objectsBaseUrl}/objects/${sha256}.zst`, onChunk);
          await this.putObject(sha256, Buffer.from(await zstdDecompressAsync(raw)));
          downloaded.objects += 1;
          downloaded.bytes += raw.byteLength;
        });
        if (!fetched) failed.push(sha256);
      });
    }

    const fallbackFull = failed.length > 0 || missing.length > FULL_FALLBACK_THRESHOLD;
    if (fallbackFull) {
      total = received + remote.full.size;
      const pack = await this.fetchBytes(`${packsBaseUrl}/${remote.full.path}`, onChunk);
      if (sha256File(pack) !== remote.full.sha256) {
        throw new Error(`Core pack integrity mismatch: ${remote.full.path}`);
      }
      downloaded.bytes += pack.byteLength;
      const entries = await decodeCorePack(pack);
      for (const sha256 of missing) {
        if (existsSync(this.objectPath(sha256))) continue;
        const content = entries.get(sha256);
        if (!content) throw new Error(`Core pack missing object ${sha256}`);
        await this.putObject(sha256, content);
      }
    }

    onApplying?.();
    const dir = await this.assemble(remote, byHash, builtin);
    return { dir, downloaded, fallbackFull } satisfies StageResult;
  }

  async gc(keep: string[]) {
    if (this.active) return;
    await rm(path.join(this.otaRoot, 'staging'), { force: true, recursive: true });
    const referenced = new Set<string>();
    for (const name of await readDirNames(this.coresDir)) {
      const dir = path.join(this.coresDir, name);
      if (!keep.includes(name) || name.endsWith('.tmp')) {
        await rm(dir, { force: true, recursive: true });
        continue;
      }
      const manifest = await this.readManifest(dir);
      for (const file of manifest?.tree ?? []) referenced.add(file.sha256);
    }
    const unreferenced = (await readDirNames(this.storeDir)).filter(
      (name) => !referenced.has(name),
    );
    await runPool(unreferenced, (name) => rm(path.join(this.storeDir, name), { force: true }));
  }

  private objectPath(sha256: string) {
    return path.join(this.storeDir, sha256);
  }

  private async fetchBytes(url: string, onChunk?: (bytes: number) => void): Promise<Buffer> {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Core OTA fetch failed (${response.status}): ${url}`);
    if (!onChunk || !response.body) return Buffer.from(await response.arrayBuffer());
    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        onChunk(value.byteLength);
      }
      return Buffer.concat(chunks);
    } finally {
      reader.releaseLock();
    }
  }

  private async putObject(sha256: string, content: Buffer) {
    if (sha256File(content) !== sha256) throw new Error(`Object sha mismatch: ${sha256}`);
    const target = this.objectPath(sha256);
    await writeFile(`${target}.tmp`, content);
    await rename(`${target}.tmp`, target);
  }

  // Renderer content is served by hash from the builtin archive or the object store, so it is
  // never materialized into the version dir.
  private async keepRendererContent(
    file: CoreManifest['tree'][number],
    byHash: Map<string, string>,
    builtinHashes: Set<string>,
  ) {
    if (existsSync(this.objectPath(file.sha256))) return;
    const source = byHash.get(file.sha256);
    if (!source) throw new Error(`Missing renderer content: ${file.path}`);
    if (builtinHashes.has(file.sha256)) return;
    await this.putObject(file.sha256, await readFile(source));
  }

  private async readManifest(dir: string): Promise<CoreManifest | null> {
    try {
      return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  private async assemble(
    remote: CoreManifest,
    byHash: Map<string, string>,
    builtin: LocalCore,
  ): Promise<string> {
    const finalDir = resolveInside(this.coresDir, remote.version);
    const tmpDir = `${finalDir}.tmp`;
    const builtinHashes = new Set(builtin.manifest.tree.map((file) => file.sha256));
    await rm(tmpDir, { force: true, recursive: true });
    await mkdir(tmpDir, { mode: DIR_MODE, recursive: true });
    try {
      await runPool(remote.tree, async (file) => {
        if (isRendererPath(file.path)) return this.keepRendererContent(file, byHash, builtinHashes);
        const target = resolveInside(tmpDir, file.path);
        await mkdir(path.dirname(target), { mode: DIR_MODE, recursive: true });
        const source = byHash.get(file.sha256) ?? this.objectPath(file.sha256);
        if (/\.asar[/\\]/.test(source)) {
          await writeFile(target, await readFile(source));
        } else
          try {
            await link(source, target);
          } catch {
            await copyFile(source, target);
          }
        if (remote.schemaVersion === 4 && sha256File(await readFile(target)) !== file.sha256)
          throw new Error(`Assembled file mismatch: ${file.path}`);
      });
      await writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(remote));
      const renderer = treeRendererSource({
        builtinDir: builtin.dir,
        builtinTree: builtin.manifest.tree,
        storeDir: this.storeDir,
        tree: remote.tree,
      });
      for (const entry of ENTRY_HTMLS) {
        const entryFile = renderer.resolve(entry);
        const missing = entryFile
          ? findMissingEntryAssets(await readFile(entryFile, 'utf8'), (relPath) =>
              Boolean(renderer.resolve(relPath)),
            )
          : ['<entry html>'];
        if (missing.length > 0) {
          throw new Error(`Entry integrity check failed (${entry}): ${missing.join(', ')}`);
        }
      }
      if (existsSync(finalDir)) {
        const existing = await this.readManifest(finalDir);
        if (JSON.stringify(existing) !== JSON.stringify(remote))
          throw new Error('Existing core version differs');
        for (const file of remote.tree) {
          if (isRendererPath(file.path)) continue;
          if (sha256File(await readFile(resolveInside(finalDir, file.path))) !== file.sha256)
            throw new Error('Existing core version is corrupt');
        }
        await rm(tmpDir, { force: true, recursive: true });
        return finalDir;
      }
      await rename(tmpDir, finalDir);
      return finalDir;
    } catch (error) {
      await rm(tmpDir, { force: true, recursive: true });
      throw error;
    }
  }
}
