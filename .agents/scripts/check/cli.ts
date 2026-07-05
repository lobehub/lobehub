/**
 * Standalone entry for this repo: `bun run check` routes every file through
 * this repo's own pipelines. Superprojects that vendor this repo as a
 * submodule ship their own entry instead, calling `runCli` with their root
 * pipelines plus this repo mounted via `lobehubPipelines`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './index';
import { lobehubPipelines } from './pipelines';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

runCli({ repos: [{ dir: '', pipelines: lobehubPipelines }], rootDir }).catch((error) => {
  console.error(`✗ check crashed: ${error?.stack ?? error}`);
  process.exit(2);
});
