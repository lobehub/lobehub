import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../..');
const dependencyPath = path.join(projectDirectory, 'node_modules');
const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'lobehub-fts-reindex-'));
const outputFile = path.join(runtimeDirectory, 'fts-search-elasticsearch-reindex.cjs');

let exitCode;
try {
  await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: [path.join(scriptDirectory, 'index.ts')],
    external: ['pg', 'drizzle-orm', 'drizzle-orm/*'],
    format: 'cjs',
    logLevel: 'warning',
    outfile: outputFile,
    platform: 'node',
    sourcemap: 'linked',
  });

  const child = spawn(
    process.execPath,
    ['--enable-source-maps', outputFile, ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        NODE_PATH: [dependencyPath, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
      },
      stdio: 'inherit',
    },
  );

  const forwardSignal = (signal) => () => {
    if (!child.killed) child.kill(signal);
  };

  const forwardInterrupt = forwardSignal('SIGINT');
  const forwardTermination = forwardSignal('SIGTERM');
  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTermination);

  exitCode = await new Promise((resolve) => {
    child.once('error', (error) => {
      console.error('Failed to launch the Elasticsearch reindex command:', error.message);
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      resolve(typeof code === 'number' ? code : signal ? 1 : 0);
    });
  });

  process.off('SIGINT', forwardInterrupt);
  process.off('SIGTERM', forwardTermination);
} finally {
  await rm(runtimeDirectory, { force: true, recursive: true }).catch((error) => {
    console.error('Failed to remove the temporary Elasticsearch reindex bundle:', error.message);
  });
}
process.exitCode = exitCode;
