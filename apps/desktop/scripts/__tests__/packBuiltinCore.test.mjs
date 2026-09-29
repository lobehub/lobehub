import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { packBuiltinCore } from '../packBuiltinCore.mjs';

const require = createRequire(import.meta.url);
const asar = createRequire(
  createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'),
)('@electron/asar');

it('packs business files while keeping a runnable CLI and its metadata outside the archive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'builtin-asar-'));
  try {
    await mkdir(path.join(dir, 'core-dist/cli/dist'), { recursive: true });
    await writeFile(path.join(dir, 'core-dist/main.js'), 'module.exports = 42;');
    await writeFile(
      path.join(dir, 'core-dist/cli/package.json'),
      JSON.stringify({ type: 'module', version: '1.2.3' }),
    );
    await writeFile(
      path.join(dir, 'core-dist/cli/dist/index.js'),
      "import { createRequire } from 'node:module'; console.log(createRequire(import.meta.url)('../package.json').version);",
    );
    await packBuiltinCore(dir);
    expect(asar.extractFile(path.join(dir, 'core.asar'), 'main.js').toString()).toBe(
      'module.exports = 42;',
    );
    await expect(readFile(path.join(dir, 'core.asar.unpacked/main.js'))).rejects.toThrow();
    expect(
      execFileSync(process.execPath, [path.join(dir, 'core.asar.unpacked/cli/dist/index.js')], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('1.2.3');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
