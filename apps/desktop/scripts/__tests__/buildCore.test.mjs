import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  coreManifestSchema,
  verifyManifestSignature,
} from '../../src/main/core/infrastructure/coreOta/manifest';
import { applyZstdPatch } from '../../src/main/core/infrastructure/coreOta/zstdPatch';
import { buildCore, EmptyReleaseError } from '../buildCore.mjs';
import { decodePack } from '../buildRendererManifest.mjs';

const SCRIPT = fileURLToPath(new URL('../buildCore.mjs', import.meta.url));

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

const bigText = (seed) =>
  Array.from({ length: 1024 }, (_, i) => `${seed} line ${i} ${'x'.repeat(20)}\n`).join('');

const baseFiles = () => ({
  'cli/lobe-cli.js': bigText('cli'),
  'dist/main/index.js': 'main v1',
  'dist/renderer/es-AAAAAAAA.js': bigText('renderer'),
  'package.json': '{"type":"commonjs"}',
});

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

let root;
let outDir;

const writeCore = async (name, files) => {
  const dir = path.join(root, name);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
};

const options = (coreDir, extra) => ({
  channel: 'canary',
  coreDir,
  objectsBaseUrl: 'https://cdn.example.com/cas',
  outDir,
  platform: 'darwin',
  privateKeyPem,
  seq: 1,
  shellAbi: 'a'.repeat(64),
  version: '1.0.0',
  ...extra,
});

const objectCount = () => readdirSync(path.join(outDir, 'cas/objects')).length;
const readJson = async (file) => JSON.parse(await readFile(path.join(outDir, file), 'utf8'));

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'build-core-'));
  outDir = path.join(root, 'out');
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('buildCore', () => {
  it('publishes objects, full pack and identical manifest snapshots for a first release', async () => {
    const files = baseFiles();
    const coreDir = await writeCore('v1', files);
    const { manifest } = await buildCore(options(coreDir));

    expect(manifest).toMatchObject({
      applyMode: null,
      channel: 'canary',
      objectsBaseUrl: 'https://cdn.example.com/cas',
      patches: [],
      platform: 'darwin',
      previous: null,
      rollout: 1,
      schemaVersion: 3,
      seq: 1,
      version: '1.0.0',
    });
    expect(manifest.tree.map((file) => file.path)).toEqual(Object.keys(files).sort());
    expect(coreManifestSchema.safeParse(manifest).success).toBe(true);
    expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(true);

    expect(objectCount()).toBe(Object.keys(files).length);
    for (const file of manifest.tree) {
      const zst = await readFile(path.join(outDir, 'cas/objects', `${file.sha256}.zst`));
      expect(sha256(zstdDecompressSync(zst))).toBe(file.sha256);
    }

    const pack = await readFile(path.join(outDir, 'core/darwin', manifest.full.path));
    expect(manifest.full).toEqual({
      path: `packs/${sha256(pack)}.zip`,
      sha256: sha256(pack),
      size: pack.byteLength,
    });
    const entries = decodePack(pack);
    expect([...entries.keys()].sort()).toEqual(
      manifest.tree.map((file) => `objects/${file.sha256}`).sort(),
    );
    for (const file of manifest.tree) {
      expect(sha256(entries.get(`objects/${file.sha256}`))).toBe(file.sha256);
    }

    const latest = await readFile(path.join(outDir, 'core/darwin/latest.json'), 'utf8');
    expect(await readFile(path.join(outDir, 'core/darwin/versions/1.0.0.json'), 'utf8')).toBe(
      latest,
    );
    expect(await readFile(path.join(coreDir, 'manifest.json'), 'utf8')).toBe(latest);
    expect(JSON.parse(latest)).toEqual(manifest);
  });

  it('emits one new object and a round-trippable patch for a renderer-only change', async () => {
    const v1 = await writeCore('v1', baseFiles());
    await buildCore(options(v1));
    const previousManifest = await readJson('core/darwin/latest.json');

    const v2Files = { ...baseFiles() };
    delete v2Files['dist/renderer/es-AAAAAAAA.js'];
    v2Files['dist/renderer/es-BBBBBBBB.js'] = bigText('renderer').replace('line 7 ', 'line 7! ');
    const v2 = await writeCore('v2', v2Files);
    const { manifest } = await buildCore(
      options(v2, { previousManifest, seq: 2, version: '1.0.1' }),
    );

    expect(manifest).toMatchObject({ applyMode: 'reload', previous: '1.0.0', seq: 2 });
    expect(objectCount()).toBe(5);
    expect(manifest.patches).toHaveLength(1);
    const [patch] = manifest.patches;
    expect(patch.fromSha256).toBe(sha256(baseFiles()['dist/renderer/es-AAAAAAAA.js']));
    expect(patch.toSha256).toBe(sha256(v2Files['dist/renderer/es-BBBBBBBB.js']));

    const patchFile = path.join(outDir, 'cas/patches', `${patch.fromSha256}-${patch.toSha256}.zst`);
    const patchContent = await readFile(patchFile);
    expect(patchContent.byteLength).toBe(patch.size);
    const restored = await applyZstdPatch(
      Buffer.from(baseFiles()['dist/renderer/es-AAAAAAAA.js']),
      patchContent,
    );
    expect(restored.toString()).toBe(v2Files['dist/renderer/es-BBBBBBBB.js']);

    expect(coreManifestSchema.safeParse(await readJson('core/darwin/latest.json')).success).toBe(
      true,
    );
    expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(true);
    expect(existsSync(path.join(outDir, 'core/darwin/versions/1.0.0.json'))).toBe(true);
  });

  it('marks relaunch when main changes and patches cli by path', async () => {
    const v1 = await writeCore('v1', baseFiles());
    await buildCore(options(v1));
    const previousManifest = await readJson('core/darwin/latest.json');

    const v3Files = {
      ...baseFiles(),
      'cli/lobe-cli.js': bigText('cli').replace('line 3 ', 'line 3? '),
      'dist/main/index.js': 'main v3',
    };
    const v3 = await writeCore('v3', v3Files);
    const { manifest } = await buildCore(
      options(v3, { previousManifest, seq: 2, version: '1.1.0' }),
    );

    expect(manifest.applyMode).toBe('relaunch');
    expect(manifest.patches).toHaveLength(1);
    expect(manifest.patches[0].toSha256).toBe(sha256(v3Files['cli/lobe-cli.js']));
  });

  it('rejects an empty release or a package.json-only diff', async () => {
    const v1 = await writeCore('v1', baseFiles());
    await buildCore(options(v1));
    const previousManifest = await readJson('core/darwin/latest.json');

    const same = await writeCore('same', baseFiles());
    await expect(
      buildCore(options(same, { previousManifest, seq: 2, version: '1.0.1' })),
    ).rejects.toThrow(EmptyReleaseError);

    const pkgOnly = await writeCore('pkg', { ...baseFiles(), 'package.json': '{"v":2}' });
    await expect(
      buildCore(options(pkgOnly, { previousManifest, seq: 2, version: '1.0.1' })),
    ).rejects.toThrow(EmptyReleaseError);
  });

  describe('previous base resolved through fetchImpl', () => {
    const oldContent = baseFiles()['dist/renderer/es-AAAAAAAA.js'];
    const v2Files = () => {
      const files = { ...baseFiles() };
      delete files['dist/renderer/es-AAAAAAAA.js'];
      files['dist/renderer/es-BBBBBBBB.js'] = oldContent.replace('line 7 ', 'line 7! ');
      return files;
    };
    const response = (body, ok = true) => ({
      arrayBuffer: async () => body,
      ok,
      status: ok ? 200 : 404,
    });

    const run = async (fetchImpl) => {
      const v1 = await writeCore('v1', baseFiles());
      await buildCore(options(v1, { outDir: path.join(root, 'out-v1') }));
      const previousManifest = JSON.parse(
        await readFile(path.join(root, 'out-v1/core/darwin/latest.json'), 'utf8'),
      );
      const v2 = await writeCore('v2', v2Files());
      const urls = [];
      const { manifest } = await buildCore(
        options(v2, {
          fetchImpl: async (url) => {
            urls.push(url);
            return fetchImpl(url);
          },
          previousManifest,
          seq: 2,
          version: '1.0.1',
        }),
      );
      return { manifest, urls };
    };

    it('patches when the object is served', async () => {
      const { manifest, urls } = await run(async () => response(zstdCompressSync(oldContent)));
      expect(urls).toEqual([`https://cdn.example.com/cas/objects/${sha256(oldContent)}.zst`]);
      expect(manifest.patches).toHaveLength(1);
    });

    it('skips the patch on non-ok, thrown fetch, or sha mismatch', async () => {
      for (const fetchImpl of [
        async () => response(null, false),
        async () => {
          throw new Error('network');
        },
        async () => response(zstdCompressSync(Buffer.from(`${oldContent}tampered`))),
      ]) {
        const { manifest } = await run(fetchImpl);
        expect(manifest.patches).toEqual([]);
        expect(manifest.applyMode).toBe('reload');
        await rm(root, { force: true, recursive: true });
        root = await mkdtemp(path.join(tmpdir(), 'build-core-'));
        outDir = path.join(root, 'out');
      }
    });
  });

  it('exits 3 with "empty release" from the CLI', async () => {
    const v1 = await writeCore('v1', baseFiles());
    await buildCore(options(v1));
    const keyFile = path.join(root, 'key.pem');
    await writeFile(keyFile, privateKeyPem);

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        `--core=${v1}`,
        '--platform=darwin',
        '--channel=canary',
        '--version=1.0.1',
        '--seq=2',
        `--shell-abi=${'a'.repeat(64)}`,
        '--objects-base-url=https://cdn.example.com/cas',
        `--out=${outDir}`,
        `--previous-manifest=${path.join(outDir, 'core/darwin/latest.json')}`,
        `--private-key-file=${keyFile}`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('empty release');
  });
});
