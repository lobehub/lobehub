import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../buildRendererManifest.mjs',
);
const nodeExecutable = process.env.RENDERER_OTA_NODE ?? 'node';

let tempDir;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { force: true, recursive: true });
});

describe('buildRendererManifest', () => {
  it('writes a self-contained renderer feed under its channel and app version', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'renderer-manifest-'));
    const rendererDir = path.join(tempDir, 'renderer');
    const outDir = path.join(tempDir, 'out');
    await mkdir(rendererDir);
    await writeFile(path.join(rendererDir, 'index.html'), '<html>renderer</html>');

    const { privateKey } = generateKeyPairSync('ed25519');
    const appVersion = '2.2.15-canary.72';
    const mainHash = 'a'.repeat(64);
    await execFileAsync(
      nodeExecutable,
      [
        script,
        `--renderer=${rendererDir}`,
        `--out=${outDir}`,
        '--channel=canary',
        '--version=r0',
        `--appVersion=${appVersion}`,
        `--mainHash=${mainHash}`,
      ],
      {
        env: {
          ...process.env,
          RENDERER_OTA_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        },
      },
    );

    const rendererRoot = path.join(outDir, 'canary', appVersion, 'renderer', 'v2');
    const manifest = JSON.parse(await readFile(path.join(rendererRoot, 'latest.json'), 'utf8'));
    expect(manifest).toMatchObject({ appVersion, mainHash, schemaVersion: 2, version: 'r0' });
    expect(manifest).not.toHaveProperty('tree');
    await access(path.join(rendererRoot, 'versions', 'r0.json'));
    const fullPack = unzipSync(
      new Uint8Array(await readFile(path.join(rendererRoot, manifest.full.path))),
    );
    const metadata = JSON.parse(Buffer.from(fullPack['meta.json']).toString('utf8'));
    expect(metadata).toMatchObject({ kind: 'full', packVersion: 1, version: 'r0' });
    expect(metadata.tree).toHaveLength(1);
    await expect(access(path.join(rendererRoot, 'files'))).rejects.toThrow();
    expect(await readdir(path.join(rendererRoot, 'packs'))).toEqual([
      `${manifest.full.sha256}.zip`,
    ]);
  });

  it('builds one delta pack from a signed V2 version snapshot', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'renderer-delta-manifest-'));
    const rendererDir = path.join(tempDir, 'renderer');
    const outDir = path.join(tempDir, 'out');
    await mkdir(rendererDir);
    const block = randomBytes(16 * 1024);
    const chunk = Buffer.concat(Array.from({ length: 8 }, () => block));
    await writeFile(path.join(rendererDir, 'chunk.js'), chunk);
    await writeFile(path.join(rendererDir, 'stable.bin'), randomBytes(128 * 1024));

    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const appVersion = '2.2.15-canary.72';
    const mainHash = 'a'.repeat(64);
    const commonArgs = [
      script,
      `--renderer=${rendererDir}`,
      `--out=${outDir}`,
      '--channel=canary',
      `--appVersion=${appVersion}`,
      `--mainHash=${mainHash}`,
    ];
    const env = { ...process.env, RENDERER_OTA_PRIVATE_KEY: privateKeyPem };

    await execFileAsync(nodeExecutable, [...commonArgs, '--version=r0'], { env });
    const rendererRoot = path.join(outDir, 'canary', appVersion, 'renderer', 'v2');
    const snapshot = path.join(rendererRoot, 'versions', 'r0.json');

    chunk[4096] = chunk[4096] === 0 ? 1 : 0;
    await writeFile(path.join(rendererDir, 'chunk.js'), chunk);
    await execFileAsync(
      nodeExecutable,
      [...commonArgs, '--version=r1', `--from-manifest=${snapshot}`],
      { env },
    );

    const manifest = JSON.parse(await readFile(path.join(rendererRoot, 'latest.json'), 'utf8'));
    expect(manifest.deltas).toHaveLength(1);
    expect(manifest.deltas[0].fromVersion).toBe('r0');
    expect(manifest.deltas[0]).not.toHaveProperty('objects');
    expect(manifest.deltas[0]).not.toHaveProperty('patches');
    expect(manifest.deltas[0].pack.path).not.toBe(manifest.full.path);
    const deltaPack = unzipSync(
      new Uint8Array(await readFile(path.join(rendererRoot, manifest.deltas[0].pack.path))),
    );
    const metadata = JSON.parse(Buffer.from(deltaPack['meta.json']).toString('utf8'));
    expect(metadata).toMatchObject({
      fromVersion: 'r0',
      kind: 'delta',
      packVersion: 1,
      version: 'r1',
    });
    expect(metadata.tree).toHaveLength(2);
    expect(metadata.patches).toHaveLength(1);
    await expect(access(path.join(rendererRoot, 'files'))).rejects.toThrow();
  });
});
