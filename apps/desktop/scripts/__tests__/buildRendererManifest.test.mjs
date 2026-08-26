import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../buildRendererManifest.mjs',
);

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
      process.execPath,
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

    const rendererRoot = path.join(outDir, 'canary', appVersion, 'renderer');
    const manifest = JSON.parse(await readFile(path.join(rendererRoot, 'latest.json'), 'utf8'));
    expect(manifest).toMatchObject({ appVersion, mainHash, version: 'r0' });
    await expect(access(path.join(rendererRoot, 'versions', 'r0.json'))).resolves.toBeUndefined();
    await expect(
      access(path.join(rendererRoot, 'files', `${manifest.files[0].sha256}.bin`)),
    ).resolves.toBeUndefined();
  });
});
