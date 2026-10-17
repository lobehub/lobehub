/**
 * Standalone entry of the file-size gate (see `sizeGate.ts`); a superproject
 * mounting this repo provides its own entry with its config.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lobehubPipelines } from './pipelines';
import { runSizeGate } from './sizeGate';

runSizeGate({
  repos: [{ dir: '', pipelines: lobehubPipelines }],
  rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
}).catch((error) => {
  console.error(`✗ size gate crashed: ${error?.stack ?? error}`);
  process.exit(2);
});
