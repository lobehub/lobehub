import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import config from './tsdown.config';

const execFileAsync = promisify(execFile);

/**
 * Runs the real bundle, not the sources. With `codeSplitting: false`, rolldown
 * wraps modules reachable from a dynamic import in lazy initializers, and a
 * binding reached only through such a wrapper stays `undefined` until that
 * dynamic import runs. Vitest executes the unbundled sources and cannot see
 * this class of bug, and the build itself still reports success.
 */
describe('CLI bundle', () => {
  let workDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'lobehub-cli-bundle-'));
    // The bundle reads `../package.json` at runtime for its version.
    await copyFile(path.join(__dirname, 'package.json'), path.join(workDir, 'package.json'));
    await build({
      ...config,
      clean: true,
      config: false,
      logLevel: 'error',
      outDir: path.join(workDir, 'dist'),
    });
    bundlePath = path.join(workDir, 'dist', 'index.js');
  }, 120_000);

  afterAll(async () => {
    await rm(workDir, { force: true, recursive: true });
  });

  const readFileWithBundle = async (filePath: string) => {
    const argsB64 = Buffer.from(JSON.stringify({ path: filePath })).toString('base64');
    const { stdout } = await execFileAsync(process.execPath, [
      bundlePath,
      'tool-worker',
      '--api',
      'readFile',
      '--args-b64',
      argsB64,
    ]);

    return JSON.parse(stdout) as {
      content: string;
      state: { content: string };
      success: boolean;
    };
  };

  it('reads a plain text file', async () => {
    const filePath = path.join(workDir, 'hello.txt');
    await writeFile(filePath, 'hello\nworld\n');

    const result = await readFileWithBundle(filePath);

    expect(result.success).toBe(true);
    expect(result.state.content).toBe('hello\nworld\n');
  });

  it('refuses an extensionless binary file by sniffing its content', async () => {
    const filePath = path.join(workDir, 'elfblob');
    // ELF magic followed by the null bytes every real binary header carries.
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]),
    );

    const result = await readFileWithBundle(filePath);

    expect(result.state.content).toContain('File appears to be binary (contains null byte)');
  });
});
