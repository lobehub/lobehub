// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, it } from 'vitest';

import { compileFixtureTools } from './compileFixtureTools';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-tool-compile-test-'));
  owned.push(root);
  await mkdir(path.join(root, 'plugins'));
  return root;
};

it('erases types, follows only local runtime imports and preserves executable plugin behavior', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'plugins/entry.ts'),
    'import {value} from "./local"; import type {Unused} from "./not-present"; console.log(value);',
  );
  await writeFile(path.join(root, 'plugins/local.ts'), 'export const value: number = 42;');
  const result = await compileFixtureTools(root, [
    { source: 'plugins/entry.ts', output: 'entry.mjs' },
  ]);
  expect(result.modules).toHaveLength(2);
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(root, '.stylex-tools/compiler/entry.mjs'),
  ]);
  expect(stdout.trim()).toBe('42');
  expect(await readFile(path.join(root, '.stylex-tools/compiler/entry.mjs'), 'utf8')).toContain(
    './local.mjs',
  );
});

it('rejects escaping source/output paths and unsupported dynamic local imports', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'plugins/entry.ts'), 'export const value = 42;');
  await expect(
    compileFixtureTools(root, [{ source: 'plugins/entry.ts', output: '../escape.mjs' }]),
  ).rejects.toThrow('PATH_ESCAPE');
  await writeFile(path.join(root, 'plugins/entry.ts'), 'export const value = import("./dynamic");');
  await expect(
    compileFixtureTools(root, [{ source: 'plugins/entry.ts', output: 'entry.mjs' }]),
  ).rejects.toThrow('DYNAMIC_LOCAL_IMPORT');
});

it('isolates compiled tools for two fixtures and rejects output namespaces outside tools', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'plugins/entry.ts'), 'export const value: number = 42;');
  for (const id of ['One', 'Two']) {
    const result = await compileFixtureTools(
      root,
      [{ source: 'plugins/entry.ts', output: 'entry.mjs' }],
      `.stylex-tools/fixtures/${id}/compiler`,
    );
    expect(result.modules[0].output).toBe(`.stylex-tools/fixtures/${id}/compiler/entry.mjs`);
  }
  await expect(compileFixtureTools(root, [], '../outside')).rejects.toThrow('PATH_ESCAPE');
});
