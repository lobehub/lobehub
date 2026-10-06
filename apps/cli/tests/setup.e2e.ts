import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll } from 'vitest';

import { validateE2EEnvironment } from './e2eEnvironment';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
// Legacy suites execute a shell command. Pin both paths instead of relying on a
// globally installed lh or accepting a command that overrides the selected home.
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
process.env.LH_CLI_PATH = `${quote(process.execPath)} ${quote(cli)}`;

beforeAll(async () => {
  validateE2EEnvironment(process.env);
  const execute = promisify(execFile);
  const options = { env: process.env, timeout: 30_000 };
  const { stdout } = await execute(process.execPath, [cli, '--version'], options);
  console.info(`Live E2E CLI: ${stdout.trim()}`);
  // Verify the explicitly selected identity before any suite creates fixtures.
  // Do not print account details, copy credentials, or delete the caller's home.
  await execute(process.execPath, [cli, 'whoami', '--json'], options);
}, 60_000);
