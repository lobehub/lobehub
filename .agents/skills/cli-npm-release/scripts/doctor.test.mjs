import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectEnvironment } from './doctor.mjs';

const require = createRequire(import.meta.url);
const directories = [];
const run = async () => ({ stdout: '1.0.0\n' });
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function put(root, file, content) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(
    path.join(root, file),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-doctor-'));
  directories.push(root);
  for (const relative of ['', 'apps/cli/']) {
    await put(root, `${relative}package.json`, {
      engines: { node: '>=22.15' },
      devDependencies: { '@lobehub/ui': '^6.12.0', 'vitest': '5.0.0' },
    });
    await put(root, `${relative}pnpm-workspace.yaml`, 'lockfile: false\n');
    await put(root, `${relative}node_modules/@lobehub/ui/package.json`, {
      name: '@lobehub/ui',
      version: '6.15.1',
    });
    await put(root, `${relative}node_modules/vitest/package.json`, {
      name: 'vitest',
      version: '5.0.0',
    });
    for (const name of relative ? ['vitest', 'tsdown'] : ['oxlint', 'tsrs'])
      await put(root, `${relative}node_modules/.bin/${name}`, 'fixture');
  }
  for (const name of ['semver', 'yaml']) {
    await symlink(
      path.dirname(require.resolve(`${name}/package.json`)),
      path.join(root, 'node_modules', name),
      'dir',
    );
  }
  return root;
}

describe('read-only release environment preflight', () => {
  it('recognizes intentionally disabled locks without installing or regenerating them', async () => {
    const root = await repository();
    const result = await inspectEnvironment(root, { run });
    expect(result.state).toBe('PASS');
    expect(result.workspaces.map((w) => w.lockfile)).toEqual(['disabled', 'disabled']);
    await expect(readFile(path.join(root, 'pnpm-lock.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('catches stale installed report dependencies before building a tarball', async () => {
    const root = await repository();
    await put(root, 'node_modules/@lobehub/ui/package.json', {
      name: '@lobehub/ui',
      version: '6.9.0',
    });
    const result = await inspectEnvironment(root, { run });
    expect(result.state).toBe('BLOCKED');
    expect(result.issues.join('\n')).toContain('@lobehub/ui expected ^6.12.0, found 6.9.0');
  });

  it('honors explicit workspace overrides rather than flagging intentional resolution', async () => {
    const root = await repository();
    await put(root, 'pnpm-workspace.yaml', 'lockfile: false\noverrides:\n  vitest: 5.1.0\n');
    await put(root, 'node_modules/vitest/package.json', {
      name: 'vitest',
      version: '5.1.0',
    });
    // The CLI has its own workspace: the root override must not leak into it.
    expect((await inspectEnvironment(root, { run })).state).toBe('PASS');
  });

  it('reports missing quality tools before their gates run', async () => {
    const root = await repository();
    await rm(path.join(root, 'node_modules/.bin/tsrs'));
    expect((await inspectEnvironment(root, { run })).issues).toContain(
      '.: missing local executable tsrs',
    );
  });

  it('does not silently choose an install policy when a required lockfile is missing', async () => {
    const root = await repository();
    await put(root, 'pnpm-workspace.yaml', 'lockfile: true\n');
    expect((await inspectEnvironment(root, { run })).issues.join('\n')).toContain(
      'lockfile enabled but missing',
    );
  });
});
