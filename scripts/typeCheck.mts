import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { bunCheckSupported } from './typeCheckSupport.ts';

const root = path.resolve(import.meta.dirname, '..');
const tsconfig = path.join(root, 'tsconfig.type-check.json');
const extra = process.argv.slice(2);

const run = (command: string, args: string[], cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

if (bunCheckSupported(process.versions.bun)) {
  // package.json "check" shadows `bun check`; run the builtin from an empty cwd.
  run(process.execPath, ['check', '-p', tsconfig, ...extra], tmpdir());
}

run(process.execPath, [
  path.join(root, 'node_modules/@typescript/native-preview/lib/tsgo.js'),
  '-p',
  tsconfig,
  '--noEmit',
  '--checkers',
  '2',
]);
