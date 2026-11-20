// @vitest-environment node
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { spawnManaged } from './managedProcess';

const readPwd = async (options: Parameters<typeof spawnManaged>[2]) => {
  const child = spawnManaged(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.PWD ?? "")'],
    options,
  );
  let output = '';
  child.stdout!.on('data', (chunk) => (output += chunk));
  await once(child, 'close');
  return output;
};

// CLIs such as OpenCode 2.x resolve their project from `PWD`, not the real cwd.
describe.skipIf(process.platform === 'win32')('spawnManaged working directory', () => {
  it.each([
    ['an explicit env', { env: { ...process.env, PWD: '/' } }],
    ['the inherited env', {}],
  ])('aligns PWD with cwd for %s', async (_name, options) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'managed-pwd-'));
    try {
      expect(await readPwd({ ...options, cwd, stdio: 'pipe' })).toBe(cwd);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it('leaves PWD alone when no cwd is given', async () => {
    expect(await readPwd({ env: { ...process.env, PWD: '/' }, stdio: 'pipe' })).toBe('/');
  });
});
