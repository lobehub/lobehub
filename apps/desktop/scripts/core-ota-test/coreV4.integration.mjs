import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  coreManifestV4Schema,
  sha256File,
  verifyManifestSignature,
} from '../../src/main/core/infrastructure/coreOta/manifest';
import { planPackDownload } from '../../src/main/core/infrastructure/coreOta/pack';
import { CoreStore } from '../../src/main/core/infrastructure/coreOta/store';
import { buildCoreV4 } from '../buildCoreV4.mjs';

const keys = generateKeyPairSync('ed25519');
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const BASE = 'https://cdn.test/core-v4/darwin';
const entries = {
  'dist/main/index.js': Buffer.from('main'),
  'dist/renderer/apps/desktop/index.html': Buffer.from('<script src="/assets/index.js"></script>'),
  'dist/renderer/apps/desktop/overlay.html': Buffer.from(
    '<script src="/assets/index.js"></script>',
  ),
  'dist/renderer/apps/desktop/popup.html': Buffer.from('<script src="/assets/index.js"></script>'),
  'dist/renderer/assets/index.js': Buffer.from('index'),
};
let root;
let files;
let responses;
let fetchImpl;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'core-v4-'));
  files = { ...entries, 'dist/renderer/assets/large.js': randomBytes(2 * 1024 ** 2) };
  responses = new Map();
  fetchImpl = vi.fn(async (url, init) => {
    const bytes = responses.get(url);
    if (!bytes) return new Response(null, { status: 404 });
    const range = new Headers(init?.headers).get('range');
    if (!range) return new Response(new Uint8Array(bytes));
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(match[1]);
    const end = Number(match[2]);
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      status: 206,
    });
  });
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});
const build = async (version, contents, previousManifest) => {
  const dir = path.join(root, version);
  for (const [file, bytes] of Object.entries(contents)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), bytes);
  }
  const { manifest: raw } = await buildCoreV4({
    channel: 'canary',
    coreDir: dir,
    fetchImpl,
    outDir: path.join(root, 'out'),
    platform: 'darwin',
    previousBaseUrl: BASE,
    previousManifest,
    privateKeyPem,
    seq: Number(version),
    shellAbi: 'a'.repeat(64),
    version,
  });
  const manifest = coreManifestV4Schema.parse(raw);
  for (const pack of manifest.packs)
    responses.set(
      `${BASE}/${pack.path}`,
      await readFile(path.join(root, 'out/core-v4/darwin', pack.path)),
    );
  return { dir, manifest };
};
const stage = async (builtin, remote) =>
  new CoreStore(path.join(root, 'ota'), fetchImpl).stage({
    builtin,
    current: null,
    packsBaseUrl: BASE,
    remote: remote.manifest,
  });
describe('v4 pack OTA', () => {
  it('builds deterministic signed packs and skips unchanged local bytes across versions', async () => {
    const v1 = await build('1', files);
    const v5 = await build('5', { ...files, 'cli/new.js': Buffer.from('new') });
    const replay = await build('6', { ...files, 'cli/new.js': Buffer.from('new') });
    expect(replay.manifest.packs).toEqual(v5.manifest.packs);
    expect(verifyManifestSignature(v5.manifest, publicKeyPem)).toBe(true);
    const result = await stage(v1, v5);
    expect(result.downloaded.bytes).toBeLessThan(1000);
    expect(result.fallbackFull).toBe(false);
    expect(await readFile(path.join(result.dir, 'cli/new.js'), 'utf8')).toBe('new');
    expect(
      fetchImpl.mock.calls.every(([, init]) => !!new Headers(init?.headers).get('range')),
    ).toBe(true);
    expect(await readFile(path.join(result.dir, 'dist/renderer/assets/large.js'))).toEqual(
      files['dist/renderer/assets/large.js'],
    );
  });
  it('keeps 401 small missing files incremental and coalesces a fresh tree into one request', async () => {
    const v1 = await build('1', files);
    const next = { ...files };
    for (let i = 0; i < 401; i++) next[`cli/${i}.js`] = Buffer.from(`new ${i}`);
    const v5 = await build('5', next);
    const result = await stage(v1, v5);
    expect(result.fallbackFull).toBe(false);
    expect(result.downloaded.bytes).toBeLessThan(100_000);
    const plan = planPackDownload(v5.manifest, Object.keys(v5.manifest.objects), new Map());
    expect(plan.ranges.reduce((n, range) => n + range.end - range.offset, 0)).toBe(
      v5.manifest.packs[0].size,
    );
    expect(plan.ranges).toHaveLength(1);
  });
  it('repairs corrupted local files and cache entries instead of reusing them', async () => {
    const v1 = await build('1', files);
    const v5 = await build('5', files);
    await writeFile(path.join(v1.dir, 'dist/main/index.js'), 'bad');
    await mkdir(path.join(root, 'ota/store'), { recursive: true });
    await writeFile(
      path.join(root, 'ota/store', sha256File(files['dist/main/index.js'])),
      'bad-cache',
    );
    const result = await stage(v1, v5);
    expect(await readFile(path.join(result.dir, 'dist/main/index.js'), 'utf8')).toBe('main');
    expect(result.downloaded.objects).toBe(1);
  });
  it('rejects wrong range offsets and never commits a version', async () => {
    const v1 = await build('1', files);
    const v5 = await build('5', { ...files, 'cli/new.js': Buffer.from('new') });
    fetchImpl.mockImplementation(
      async () =>
        new Response(new Uint8Array(10), {
          headers: { 'Content-Range': 'bytes 0-9/10' },
          status: 206,
        }),
    );
    await expect(stage(v1, v5)).rejects.toThrow('Range');
    await expect(readFile(path.join(root, 'ota/cores/5/manifest.json'))).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('cancels ignored ranges and downloads the full pack once', async () => {
    const v1 = await build('1', files);
    const v5 = await build('5', { ...files, 'cli/new.js': Buffer.from('new') });
    fetchImpl.mockImplementation(async (url) => new Response(new Uint8Array(responses.get(url))));
    const result = await stage(v1, v5);
    expect(result.fallbackFull).toBe(true);
    expect(fetchImpl.mock.calls.filter(([, init]) => !init)).toHaveLength(1);
    expect(await readFile(path.join(result.dir, 'cli/new.js'), 'utf8')).toBe('new');
  });
  it('uses a matching file patch but can skip versions without its base', async () => {
    const text = Buffer.from(
      Array.from({ length: 10000 }, (_, i) => `line ${i}: something useful\n`).join(''),
    );
    const v1 = await build('1', { ...files, 'cli/lobe-cli.js': text });
    const updated = Buffer.from(text.toString().replace('line 30:', 'edited 30:'));
    const v5 = await build('5', { ...files, 'cli/lobe-cli.js': updated }, v1.manifest);
    expect(v5.manifest.patches).toHaveLength(1);
    fetchImpl.mockClear();
    const result = await stage(v1, v5);
    expect(result.downloaded.patches).toBe(1);
    const v0 = await build('0', files);
    await rm(path.join(root, 'ota'), { recursive: true, force: true });
    const skipped = await stage(v0, v5);
    expect(skipped.downloaded.patches).toBe(0);
    expect(await readFile(path.join(skipped.dir, 'cli/lobe-cli.js'))).toEqual(updated);
  });
  it('rejects malformed locations before downloading', async () => {
    const { manifest } = await build('1', files);
    const hash = Object.keys(manifest.objects)[0];
    expect(
      coreManifestV4Schema.safeParse({
        ...manifest,
        objects: {
          ...manifest.objects,
          [hash]: { ...manifest.objects[hash], offset: Number.MAX_SAFE_INTEGER },
        },
      }).success,
    ).toBe(false);
    expect(coreManifestV4Schema.safeParse({ ...manifest, objects: {} }).success).toBe(false);
  });
  it('falls back only the failed patch and rejects corrupt object frames', async () => {
    const text = Buffer.from(
      Array.from({ length: 10000 }, (_, i) => `line ${i}: useful content\n`).join(''),
    );
    const v1 = await build('1', { ...files, 'cli/lobe-cli.js': text });
    const updated = Buffer.from(text.toString().replace('line 30:', 'changed 30:'));
    const v5 = await build('5', { ...files, 'cli/lobe-cli.js': updated }, v1.manifest);
    const patch = v5.manifest.patches[0];
    const pack = v5.manifest.packs.find((p) => p.sha256 === patch.packSha256);
    responses.get(`${BASE}/${pack.path}`)[patch.offset] ^= 1;
    fetchImpl.mockClear();
    const result = await stage(v1, v5);
    expect(result.downloaded).toMatchObject({ objects: 1, patches: 0 });
    expect(result.fallbackFull).toBe(false);
    expect(await readFile(path.join(result.dir, 'cli/lobe-cli.js'))).toEqual(updated);
    await rm(path.join(root, 'ota'), { recursive: true, force: true });
    const frame = v5.manifest.objects[sha256File(updated)];
    const objectPack = v5.manifest.packs.find((p) => p.sha256 === frame.packSha256);
    responses.get(`${BASE}/${objectPack.path}`)[frame.offset] ^= 1;
    await expect(stage(v1, v5)).rejects.toThrow('hash mismatch');
    await expect(readFile(path.join(root, 'ota/cores/5/manifest.json'))).rejects.toThrow();
  });

  it('does not replace an existing corrupt version directory', async () => {
    const v1 = await build('1', files);
    const v5 = await build('5', { ...files, 'cli/new.js': Buffer.from('new') });
    const result = await stage(v1, v5);
    await writeFile(path.join(result.dir, 'cli/new.js'), 'user-owned');
    await expect(stage(v1, v5)).rejects.toThrow('Existing core version is corrupt');
    expect(await readFile(path.join(result.dir, 'cli/new.js'), 'utf8')).toBe('user-owned');
  });
});
