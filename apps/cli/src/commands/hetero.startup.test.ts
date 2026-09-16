import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cliEntry = fileURLToPath(new URL('../index.ts', import.meta.url));

describe.skipIf(process.platform === 'win32')(
  'Pi startup cancellation across real processes',
  () => {
    it.each(['SIGINT', 'SIGTERM', 'double-SIGINT'] as const)(
      'cleans up a hung handshake on %s before a handle exists',
      async (signal) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'pi-startup-'));
        const pidFile = path.join(directory, 'pid');
        const executable = path.join(directory, 'pi.mjs');
        await writeFile(
          executable,
          `#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
if (process.argv.includes('--version')) { console.log('0.85.1'); process.exit(0); }
process.stdin.resume();
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
await writeFile(${JSON.stringify(pidFile)}, String(process.pid));
`,
        );
        await chmod(executable, 0o700);
        const child = spawn(
          'bun',
          [
            '--no-env-file',
            cliEntry,
            'hetero',
            'exec',
            '--type',
            'pi',
            '--command',
            executable,
            '--cwd',
            directory,
            '--prompt',
            'must not reach the model',
            '--operation-id',
            'startup-regression',
          ],
          {
            cwd: directory,
            env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const exited = once(child, 'close');
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.stdout.resume();
        let piPid: number | undefined;
        try {
          await expect
            .poll(
              async () => {
                try {
                  piPid = Number(await readFile(pidFile, 'utf8'));
                  return piPid;
                } catch {
                  return undefined;
                }
              },
              { timeout: 15000 },
            )
            .toBeTruthy();
          child.kill(signal === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
          if (signal === 'double-SIGINT') {
            await new Promise((resolve) => setTimeout(resolve, 50));
            child.kill('SIGINT');
          }
          const [code] = await exited;
          expect(code, stderr).toBe(
            signal === 'SIGTERM' ? 143 : signal === 'double-SIGINT' ? 137 : 130,
          );
          expect(() => process.kill(piPid!, 0)).toThrow();
        } finally {
          child.kill('SIGKILL');
          if (piPid) {
            try {
              process.kill(-piPid, 'SIGKILL');
            } catch {
              /* already reaped */
            }
          }
          await exited;
          await rm(directory, { force: true, recursive: true });
        }
      },
      25000,
    );
  },
);
