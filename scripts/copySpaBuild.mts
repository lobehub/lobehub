import path from 'node:path';

import { copySpaBuild } from './copySpaBuildCore.ts';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, '..');

copySpaBuild(root);
