import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import type * as fsp from 'node:fs/promises';
import { link, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CoreManifest, sha256File } from '../manifest';
import { cleanupLegacy, CoreStore, indexLocal, isSafeVersion } from '../store';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsp>();
  return { ...actual, link: vi.fn(actual.link) };
});

const OBJECTS = 'https://cdn.test/cas';
const PACKS = 'https://cdn.test/core/darwin';
const ENTRY_FILES: Record<string, string> = {
  'dist/renderer/apps/desktop/index.html': '<script src="/assets/index.js"></script>',
  'dist/renderer/apps/desktop/overlay.html': '<script src="/assets/overlay.js"></script>',
  'dist/renderer/apps/desktop/popup.html': '<script src="/assets/popup.js"></script>',
  'dist/renderer/assets/index.js': 'index',
  'dist/renderer/assets/overlay.js': 'overlay',
  'dist/renderer/assets/popup.js': 'popup',
};

let root: string;
let served: Map<string, Buffer>;
let fetchImpl: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

const zst = (content: Buffer, dictionary?: Buffer) =>
  zstdCompressSync(content, {
    dictionary,
    params: { [constants.ZSTD_c_compressionLevel]: 19 },
  });

const manifestFor = (version: string, files: Record<string, string>): CoreManifest => {
  const objects = new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)] as const));
  const tree = [...objects]
    .map(([p, content]) => ({ path: p, sha256: sha256File(content), size: content.length }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const zippable: Record<string, Uint8Array> = {};
  for (const [, content] of objects) zippable[`objects/${sha256File(content)}`] = content;
  const pack = Buffer.from(zipSync(zippable));
  const packSha = sha256File(pack);
  served.set(`${PACKS}/packs/${packSha}.zip`, pack);
  for (const [, content] of objects) {
    served.set(`${OBJECTS}/objects/${sha256File(content)}.zst`, zst(content));
  }
  return {
    applyMode: 'reload',
    channel: 'stable',
    full: { path: `packs/${packSha}.zip`, sha256: packSha, size: pack.length },
    objectsBaseUrl: OBJECTS,
    patches: [],
    platform: 'darwin',
    previous: null,
    rollout: 1,
    schemaVersion: 3,
    seq: 1,
    shellAbi: 'a'.repeat(64),
    signature: 'sig',
    tree,
    version,
  };
};

const materialize = async (dir: string, files: Record<string, string>) => {
  for (const [p, c] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), c);
  }
};

const localCore = async (name: string, files: Record<string, string>) => {
  const dir = path.join(root, name);
  await materialize(dir, files);
  return { dir, manifest: manifestFor(name, files) };
};

const readTree = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'manifest.json')
      .map((entry) => {
        const abs = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, abs), readFileSync(abs, 'utf8')];
      }),
  );

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'core-store-'));
  served = new Map();
  fetchImpl = vi.fn(async (url: string) =>
    served.has(url)
      ? new Response(new Uint8Array(served.get(url)!))
      : new Response(null, { status: 404 }),
  );
  vi.mocked(link).mockClear();
});

afterEach(() => rmSync(root, { force: true, recursive: true }));

const store = () => new CoreStore(path.join(root, 'ota'), fetchImpl);
const stage = async (
  remote: CoreManifest,
  current: Awaited<ReturnType<typeof localCore>> | null,
  builtin: Awaited<ReturnType<typeof localCore>>,
) => store().stage({ builtin, current, objectsBaseUrl: OBJECTS, packsBaseUrl: PACKS, remote });

describe('indexLocal', () => {
  it('maps every tree sha to its absolute path', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const index = indexLocal(builtin.dir, builtin.manifest);
    expect(index.size).toBe(Object.keys(ENTRY_FILES).length);
    expect(index.get(sha256File(Buffer.from('index')))).toBe(
      path.join(builtin.dir, 'dist/renderer/assets/index.js'),
    );
  });
});

describe('CoreStore.stage', () => {
  it('downloads every object for a fresh tree and assembles cores/<v>', async () => {
    const builtin = await localCore('builtin', { 'cli/old.js': 'old' });
    const files = { ...ENTRY_FILES, 'package.json': '{}' };
    const remote = manifestFor('1.1.0', files);

    const result = await stage(remote, null, builtin);

    expect(result.dir).toBe(path.join(root, 'ota/cores/1.1.0'));
    expect(result.fallbackFull).toBe(false);
    expect(result.downloaded).toMatchObject({ objects: 7, patches: 0 });
    expect(result.downloaded.bytes).toBeGreaterThan(0);
    expect(readTree(result.dir)).toEqual(files);
    expect(JSON.parse(readFileSync(path.join(result.dir, 'manifest.json'), 'utf8'))).toEqual(
      remote,
    );
    for (const file of remote.tree) {
      expect(existsSync(path.join(root, 'ota/store', file.sha256))).toBe(true);
    }
    expect(existsSync(path.join(root, 'ota/cores/1.1.0.tmp'))).toBe(false);
  });

  it('downloads nothing when every sha is present locally', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES });

    const result = await stage(remote, null, builtin);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.downloaded).toEqual({ bytes: 0, objects: 0, patches: 0 });
    expect(readTree(result.dir)).toEqual(ENTRY_FILES);
  });

  it('prefers a patch when the base sha is local', async () => {
    const oldContent = Buffer.from('a'.repeat(4000));
    const newContent = Buffer.from(`${'a'.repeat(4000)}!`);
    const builtin = await localCore('builtin', {
      ...ENTRY_FILES,
      'cli/big.js': oldContent.toString(),
    });
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/big.js': newContent.toString() });
    const from = sha256File(oldContent);
    const to = sha256File(newContent);
    const patch = zst(newContent, oldContent);
    served.set(`${OBJECTS}/patches/${from}-${to}.zst`, patch);
    remote.patches = [{ fromSha256: from, size: patch.length, toSha256: to }];

    const result = await stage(remote, null, builtin);

    expect(result.downloaded).toEqual({ bytes: patch.length, objects: 0, patches: 1 });
    expect(readFileSync(path.join(result.dir, 'cli/big.js'), 'utf8')).toBe(newContent.toString());
  });

  it('falls back to the object when the patch is corrupt', async () => {
    const builtin = await localCore('builtin', { ...ENTRY_FILES, 'cli/x.js': 'old' });
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/x.js': 'new' });
    const from = sha256File(Buffer.from('old'));
    const to = sha256File(Buffer.from('new'));
    served.set(`${OBJECTS}/patches/${from}-${to}.zst`, Buffer.from('garbage'));
    remote.patches = [{ fromSha256: from, size: 7, toSha256: to }];

    const result = await stage(remote, null, builtin);

    expect(result.downloaded).toMatchObject({ objects: 1, patches: 0 });
    expect(result.fallbackFull).toBe(false);
    expect(readFileSync(path.join(result.dir, 'cli/x.js'), 'utf8')).toBe('new');
  });

  it('falls back to the full pack when an object download fails', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/x.js': 'new' });
    served.delete(`${OBJECTS}/objects/${sha256File(Buffer.from('new'))}.zst`);

    const result = await stage(remote, null, builtin);

    expect(result.fallbackFull).toBe(true);
    expect(result.downloaded.objects).toBe(0);
    expect(readFileSync(path.join(result.dir, 'cli/x.js'), 'utf8')).toBe('new');
    expect(fetchImpl).toHaveBeenCalledWith(`${PACKS}/${remote.full.path}`);
  });

  it('goes straight to the full pack when too many objects are missing', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const files = { ...ENTRY_FILES };
    for (let i = 0; i < 401; i++) files[`cli/${i}.js`] = `file-${i}`;
    const remote = manifestFor('1.1.0', files);

    const result = await stage(remote, null, builtin);

    expect(result.fallbackFull).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readTree(result.dir)).toEqual(files);
  });

  it('never lands a sha-mismatched object in the store', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/x.js': 'new' });
    const sha = sha256File(Buffer.from('new'));
    served.set(`${OBJECTS}/objects/${sha}.zst`, zst(Buffer.from('evil')));
    served.set(`${PACKS}/${remote.full.path}`, Buffer.from('not a zip'));

    await expect(stage(remote, null, builtin)).rejects.toThrow();

    expect(existsSync(path.join(root, 'ota/store', sha))).toBe(false);
    expect(readdirSync(path.join(root, 'ota/store')).some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(existsSync(path.join(root, 'ota/cores/1.1.0.tmp'))).toBe(false);
  });

  it('rejects tree paths escaping the target dir and leaves no residue', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/x.js': 'new' });
    remote.tree.find((file) => file.path === 'cli/x.js')!.path = '../../escape.js';

    await expect(stage(remote, null, builtin)).rejects.toThrow(/outside/);

    expect(existsSync(path.join(root, 'ota/cores/1.1.0.tmp'))).toBe(false);
    expect(existsSync(path.join(root, 'ota/cores/1.1.0'))).toBe(false);
    expect(existsSync(path.join(root, 'escape.js'))).toBe(false);
  });

  it('rejects an unsafe version before touching the filesystem', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    await materialize(root, { 'evil/keep.txt': 'x' });
    const remote = manifestFor('../../evil', { ...ENTRY_FILES, 'cli/x.js': 'new' });

    await expect(stage(remote, null, builtin)).rejects.toThrow(/Unsafe version/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, 'evil/keep.txt'))).toBe(true);
    expect(existsSync(path.join(root, 'evil.tmp'))).toBe(false);
    expect(existsSync(path.join(root, 'ota/cores'))).toBe(false);
  });

  it('hard-links assembled files and copies when link fails', async () => {
    const builtin = await localCore('builtin', ENTRY_FILES);
    const remote = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/x.js': 'new' });

    const linked = await stage(remote, null, builtin);
    expect(statSync(path.join(linked.dir, 'cli/x.js')).nlink).toBe(2);
    expect(statSync(path.join(linked.dir, 'dist/renderer/assets/index.js')).nlink).toBe(2);

    vi.mocked(link).mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    const copied = await stage(
      manifestFor('1.2.0', { ...ENTRY_FILES, 'cli/x.js': 'new' }),
      null,
      builtin,
    );
    expect(statSync(path.join(copied.dir, 'cli/x.js')).nlink).toBe(1);
    expect(readTree(copied.dir)).toEqual({ ...ENTRY_FILES, 'cli/x.js': 'new' });
    vi.mocked(link).mockReset();
  });
});

describe('CoreStore.gc', () => {
  it('keeps listed versions and their referenced objects only', async () => {
    const builtin = await localCore('builtin', { 'cli/unrelated.js': 'x' });
    const kept = manifestFor('1.1.0', { ...ENTRY_FILES, 'cli/a.js': 'keep' });
    const keep = await stage(kept, null, builtin);
    await stage(manifestFor('1.2.0', { ...ENTRY_FILES, 'cli/b.js': 'drop' }), null, builtin);
    const ota = path.join(root, 'ota');
    await materialize(ota, {
      'cores/1.3.0.tmp/manifest.json': '{}',
      'staging/leftover': 'x',
      'store/deadbeef.tmp': 'x',
    });

    await store().gc(['1.1.0']);

    expect(readdirSync(path.join(ota, 'cores'))).toEqual(['1.1.0']);
    expect(existsSync(path.join(ota, 'staging'))).toBe(false);
    expect(readTree(keep.dir)).toEqual({ ...ENTRY_FILES, 'cli/a.js': 'keep' });
    expect(readdirSync(path.join(ota, 'store')).sort()).toEqual(
      [...new Set(kept.tree.map((file) => file.sha256))].sort(),
    );
  });
});

describe('isSafeVersion', () => {
  it('accepts plain version segments only', () => {
    expect(['1.2.3', '1.2.3-beta.1+build', 'v1_2']).toEqual(
      ['1.2.3', '1.2.3-beta.1+build', 'v1_2'].filter(isSafeVersion),
    );
    expect(['', '.', '..', '../x', 'a/b', 'a\\b', 'x'.repeat(65)].some(isSafeVersion)).toBe(false);
  });
});

describe('cleanupLegacy', () => {
  it('removes the legacy renderer OTA dirs', async () => {
    await materialize(root, { 'renderer-ota-v2/x': '1', 'renderer-ota/y': '2', 'other/z': '3' });

    await cleanupLegacy(root);

    expect(existsSync(path.join(root, 'renderer-ota-v2'))).toBe(false);
    expect(existsSync(path.join(root, 'renderer-ota'))).toBe(false);
    expect(existsSync(path.join(root, 'other/z'))).toBe(true);
  });
});
