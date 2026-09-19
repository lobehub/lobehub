import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

import { unzip } from 'fflate';

import { type CoreManifest, findMissingEntryAssets, sha256File } from './manifest';
import { applyZstdPatch } from './zstdPatch';

type FetchImpl = (url: string) => Promise<Response>;
type LocalCore = { dir: string; manifest: CoreManifest };
type StageInput = {
  builtin: LocalCore;
  current: LocalCore | null;
  objectsBaseUrl: string;
  packsBaseUrl: string;
  remote: CoreManifest;
};
type StageResult = {
  dir: string;
  downloaded: { bytes: number; objects: number; patches: number };
  fallbackFull: boolean;
};

const RENDERER_ROOT = 'dist/renderer';
const ENTRY_HTMLS = ['index.html', 'overlay.html', 'popup.html'].map((name) =>
  path.join(RENDERER_ROOT, 'apps', 'desktop', name),
);
const FULL_FALLBACK_THRESHOLD = 400;
const CONCURRENCY = 8;
const PACK_ENTRY = /^objects\/([0-9a-f]{64})$/;
const DIR_MODE = 0o700;
export const SAFE_VERSION = /^[\w.+-]{1,64}$/;

const zstdDecompressAsync = promisify(zstdDecompress);

const runPool = async <T>(items: T[], worker: (item: T) => Promise<void>) => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
};

const attempt = (task: () => Promise<void>) =>
  task().then(
    () => true,
    () => false,
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

export const indexLocal = (coreDir: string, manifest: CoreManifest): Map<string, string> =>
  new Map(manifest.tree.map((file) => [file.sha256, path.join(coreDir, file.path)]));

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
  private readonly storeDir: string;
  private readonly coresDir: string;

  constructor(
    private readonly otaRoot: string,
    private readonly fetchImpl: FetchImpl,
  ) {
    this.storeDir = path.join(otaRoot, 'store');
    this.coresDir = path.join(otaRoot, 'cores');
  }

  async stage({ builtin, current, objectsBaseUrl, packsBaseUrl, remote }: StageInput) {
    if (!isSafeVersion(remote.version)) throw new Error(`Unsafe version: ${remote.version}`);
    await mkdir(this.storeDir, { mode: DIR_MODE, recursive: true });
    await mkdir(this.coresDir, { mode: DIR_MODE, recursive: true });

    const byHash = new Map([
      ...indexLocal(builtin.dir, builtin.manifest),
      ...(current ? indexLocal(current.dir, current.manifest) : []),
    ]);
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
          (await attempt(async () => {
            const url = `${objectsBaseUrl}/patches/${patch.fromSha256}-${patch.toSha256}.zst`;
            const raw = await this.fetchBytes(url);
            const base = await readFile(byHash.get(patch.fromSha256)!);
            await this.putObject(sha256, await applyZstdPatch(base, raw));
            downloaded.patches += 1;
            downloaded.bytes += raw.byteLength;
          }));
        if (patched) return;
        const fetched = await attempt(async () => {
          const raw = await this.fetchBytes(`${objectsBaseUrl}/objects/${sha256}.zst`);
          await this.putObject(sha256, Buffer.from(await zstdDecompressAsync(raw)));
          downloaded.objects += 1;
          downloaded.bytes += raw.byteLength;
        });
        if (!fetched) failed.push(sha256);
      });
    }

    const fallbackFull = failed.length > 0 || missing.length > FULL_FALLBACK_THRESHOLD;
    if (fallbackFull) {
      const pack = await this.fetchBytes(`${packsBaseUrl}/${remote.full.path}`);
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

    const dir = await this.assemble(remote, byHash);
    return { dir, downloaded, fallbackFull } satisfies StageResult;
  }

  async gc(keep: string[], { keepStore = false } = {}) {
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
    if (keepStore) return;
    for (const name of await readDirNames(this.storeDir)) {
      if (!referenced.has(name)) await rm(path.join(this.storeDir, name), { force: true });
    }
  }

  private objectPath(sha256: string) {
    return path.join(this.storeDir, sha256);
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Core OTA fetch failed (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async putObject(sha256: string, content: Buffer) {
    if (sha256File(content) !== sha256) throw new Error(`Object sha mismatch: ${sha256}`);
    const target = this.objectPath(sha256);
    await writeFile(`${target}.tmp`, content);
    await rename(`${target}.tmp`, target);
  }

  private async readManifest(dir: string): Promise<CoreManifest | null> {
    try {
      return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  private async assemble(remote: CoreManifest, byHash: Map<string, string>): Promise<string> {
    const finalDir = resolveInside(this.coresDir, remote.version);
    const tmpDir = `${finalDir}.tmp`;
    await rm(tmpDir, { force: true, recursive: true });
    await mkdir(tmpDir, { mode: DIR_MODE, recursive: true });
    try {
      for (const file of remote.tree) {
        const target = resolveInside(tmpDir, file.path);
        await mkdir(path.dirname(target), { mode: DIR_MODE, recursive: true });
        const source = byHash.get(file.sha256) ?? this.objectPath(file.sha256);
        try {
          await link(source, target);
        } catch {
          await copyFile(source, target);
        }
      }
      await writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(remote));
      const rendererDir = path.join(tmpDir, RENDERER_ROOT);
      for (const entry of ENTRY_HTMLS) {
        const missing = findMissingEntryAssets(
          await readFile(path.join(tmpDir, entry), 'utf8'),
          (relPath) => existsSync(path.join(rendererDir, relPath)),
        );
        if (missing.length > 0) {
          throw new Error(`Entry integrity check failed (${entry}): ${missing.join(', ')}`);
        }
      }
      await rm(finalDir, { force: true, recursive: true });
      await rename(tmpDir, finalDir);
      return finalDir;
    } catch (error) {
      await rm(tmpDir, { force: true, recursive: true });
      throw error;
    }
  }
}
