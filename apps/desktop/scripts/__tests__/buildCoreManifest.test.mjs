import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  coreManifestSchema,
  verifyManifestSignature,
} from '../../src/main/core/infrastructure/coreOta/manifest';
import {
  buildCoreManifest,
  PLACEHOLDER_FULL,
  PLACEHOLDER_OBJECTS_BASE_URL,
} from '../buildCoreManifest.mjs';

const shellLoader = createRequire(import.meta.url)('../../shell/core-loader.js');

let root;

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

const files = {
  'dist/main/index.js': 'main',
  'dist/preload/index.js': 'preload',
  'dist/renderer/index.html': '<html></html>',
  'resources/tray.png': 'png',
};

const setup = async () => {
  root = await mkdtemp(path.join(tmpdir(), 'core-manifest-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await writeFile(path.join(root, 'manifest.json'), '{}');
};

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
};

const options = (extra) => ({
  channel: 'canary',
  coreDir: root,
  platform: 'darwin',
  seq: 7,
  shellAbi: 'a'.repeat(64),
  version: '2.3.0',
  ...extra,
});

afterEach(async () => {
  if (root) await rm(root, { force: true, recursive: true });
});

describe('buildCoreManifest', () => {
  it('covers every file with correct hashes and validates against the core schema', async () => {
    await setup();
    const { privateKeyPem } = keys();
    const manifest = await buildCoreManifest(
      options({ objectsBaseUrl: 'https://cdn.example.com/cas', privateKeyPem }),
    );

    expect(manifest.tree).toEqual(
      Object.entries(files).map(([file, content]) => ({
        path: file,
        sha256: sha256(content),
        size: Buffer.byteLength(content),
      })),
    );
    expect(manifest).toMatchObject({
      applyMode: null,
      channel: 'canary',
      objectsBaseUrl: 'https://cdn.example.com/cas',
      patches: [],
      platform: 'darwin',
      previous: null,
      rollout: 1,
      schemaVersion: 3,
      seq: 7,
      shellAbi: 'a'.repeat(64),
      version: '2.3.0',
    });
    expect(manifest.full).toEqual(PLACEHOLDER_FULL);
    expect(coreManifestSchema.safeParse(manifest).success).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))).toEqual(manifest);
  });

  it('signs so the shell loader verifies, and rejects a tampered byte', async () => {
    await setup();
    const { privateKeyPem, publicKeyPem } = keys();
    const manifest = await buildCoreManifest(options({ privateKeyPem }));
    expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(true);
    expect(shellLoader.verifyManifestSignature(manifest, publicKeyPem)).toBe(true);

    const tampered = structuredClone(manifest);
    tampered.tree[0].sha256 = `b${tampered.tree[0].sha256.slice(1)}`;
    expect(verifyManifestSignature(tampered, publicKeyPem)).toBe(false);
    expect(shellLoader.verifyManifestSignature(tampered, publicKeyPem)).toBe(false);
  });

  it('writes an empty signature without a private key', async () => {
    await setup();
    const manifest = await buildCoreManifest(options());
    expect(manifest.signature).toBe('');
    expect(manifest.objectsBaseUrl).toBe(PLACEHOLDER_OBJECTS_BASE_URL);
  });

  it('rejects a manifest whose shellAbi is not a sha256', async () => {
    await setup();
    await expect(buildCoreManifest(options({ shellAbi: 'dev' }))).rejects.toThrow(/shellAbi/);
  });
});
