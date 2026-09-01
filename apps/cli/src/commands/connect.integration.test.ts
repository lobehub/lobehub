import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

interface CliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const tempHomes: string[] = [];

async function runCli(
  args: string[],
  home: string,
  extraEnv: Record<string, string> = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'bun',
      [path.resolve(import.meta.dirname, '../index.ts'), ...args],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          HOME: home,
          LOBEHUB_CLI_API_KEY: '',
          LOBEHUB_CLI_HOME: '.lobehub',
          LOBEHUB_JWT: '',
          ...extraEnv,
        },
        timeout: 10_000,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }

        resolve({
          exitCode: typeof error?.code === 'number' ? error.code : 0,
          stderr,
          stdout,
        });
      },
    );
  });
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('connect daemon startup', () => {
  it('reports a startup failure instead of claiming the daemon started', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);

    const result = await runCli(['connect', '--daemon'], home);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('No authentication found');
  });

  it('surfaces the underlying network error when startup retries are exhausted', async () => {
    const portProbe = createServer();
    await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
    const { port } = portProbe.address() as AddressInfo;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);

    const result = await runCli(['connect', '--workspace', 'workspace-id', '--daemon'], home, {
      LOBEHUB_JWT: `${header}.${payload}.signature`,
      LOBEHUB_SERVER: `http://127.0.0.1:${port}`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('ConnectionRefused');
  }, 15_000);
});
