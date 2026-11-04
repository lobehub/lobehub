import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecord, digest } from './record.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./release.mjs', import.meta.url));
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function preparation() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'release-verify-'));
  directories.push(directory);
  const bytes = Buffer.from('prepared tarball');
  const record = createRecord();
  Object.assign(record, {
    version: '0.0.76',
    tag: 'latest',
    artifact: {
      path: 'cli.tgz',
      sha256: digest(bytes),
      integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`,
      size: bytes.length,
      node: process.version,
      platform: process.platform,
    },
  });
  record.baseline.channelVersion = '0.0.75';
  await mkdir(path.join(directory, 'bin'));
  await Promise.all([
    writeFile(path.join(directory, 'cli.tgz'), bytes),
    writeFile(path.join(directory, 'release.json'), JSON.stringify(record)),
    writeFile(
      path.join(directory, 'bin/npm'),
      `#!${process.execPath}\nif(process.argv[2] !== 'view') process.exit(99);\nconsole.log(JSON.stringify(process.argv[3].endsWith('@0.0.76') ? ${JSON.stringify({ 'version': record.version, 'dist.integrity': record.artifact.integrity })} : {latest:'0.0.76'}));\n`,
      { mode: 0o755 },
    ),
  ]);
  const run = () =>
    exec(process.execPath, [script, 'verify', directory], {
      env: { ...process.env, PATH: path.join(directory, 'bin') },
      timeout: 10000,
    });
  return { directory, record, run };
}

describe('read-only verification without publication approval', () => {
  it('verifies an independently published artifact while preserving unknown preparation gates', async () => {
    const { directory, record, run } = await preparation();
    const { stdout } = await run();
    expect(stdout).toContain('VERIFIED');
    const files = await readdir(path.join(directory, 'verification'));
    const result = JSON.parse(
      await readFile(path.join(directory, 'verification', files[0]), 'utf8'),
    );
    expect(result).toMatchObject({
      state: 'VERIFIED',
      preparationSeal: 'ABSENT',
      expectedIntegrity: record.artifact.integrity,
    });
    expect(JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'))).toEqual(
      record,
    );
    await expect(readFile(path.join(directory, 'handoff.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects an artifact that no longer matches its fingerprint', async () => {
    const { directory, run } = await preparation();
    await writeFile(path.join(directory, 'cli.tgz'), 'changed');
    await expect(run()).rejects.toMatchObject({
      stderr: expect.stringContaining('Tarball checksum'),
    });
  });

  it('never falls back to unsealed verification when a seal exists but is invalid', async () => {
    const { directory, run } = await preparation();
    await writeFile(path.join(directory, 'handoff.json'), JSON.stringify({ digest: 'invalid' }));
    await expect(run()).rejects.toThrow();
    await expect(readdir(path.join(directory, 'verification'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
