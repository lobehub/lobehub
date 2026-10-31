import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { fingerprintSources } from './reporting/report';

/** Bun compiles; Node owns Playwright. Avoid tsx's function-serialization helpers. */
const main = async () => {
  const sourceDirectory = import.meta.dirname;
  const repository = path.resolve(sourceDirectory, '../../..');
  const sourceDirectories = [sourceDirectory];
  const verifierHash = await fingerprintSources(sourceDirectories);
  const parent = path.join(repository, '.records/stylex-verification/runners');
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, 'node-'));
  await promisify(execFile)(
    process.execPath,
    [
      'build',
      '--target=node',
      '--packages=external',
      '--entry-naming=[name].mjs',
      '--outdir',
      output,
      path.join(sourceDirectory, 'cli.ts'),
    ],
    { maxBuffer: 8 * 1024 ** 2, timeout: 30_000 },
  );
  if ((await fingerprintSources(sourceDirectories)) !== verifierHash)
    throw new Error('VERIFIER_CHANGED_DURING_BUILD');
  const child = spawn('node', [path.join(output, 'cli.mjs'), ...process.argv.slice(2)], {
    env: {
      ...process.env,
      STYLEX_VERIFIER_REPOSITORY: repository,
      STYLEX_VERIFIER_SOURCE_DIRECTORY: sourceDirectory,
      STYLEX_VERIFIER_SOURCE_HASH: verifierHash,
    },
    stdio: 'inherit',
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 3));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 3;
});
