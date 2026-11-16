import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { newErrors } from './overlayTypeErrors.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('overlayTypeErrors.mjs', import.meta.url));

const missingKey =
  "src/features/AgentShareSettings/LimitsSection.tsx(98,33): error TS2339: Property 'agentShareStatus' does not exist on type '{ topic: KeyFactory<[id: string]>; }'.";
const implicitAny =
  "src/features/AgentShareSettings/ProfileSection/index.tsx(116,11): error TS7031: Binding element 'offset' implicitly has an 'any' type.";

const run = async (t, base, head) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'overlay-type-errors-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const files = [path.join(dir, 'base.log'), path.join(dir, 'head.log')];
  if (base !== undefined) await writeFile(files[0], base);
  await writeFile(files[1], head);
  return exec('node', [cli, ...files]).then(
    ({ stdout }) => ({ code: 0, stdout }),
    ({ code, stdout }) => ({ code, stdout }),
  );
};

test('reports a type error the base does not have', () => {
  assert.deepEqual(newErrors(implicitAny, [implicitAny, missingKey].join('\n')), [
    "src/features/AgentShareSettings/LimitsSection.tsx: TS2339: Property 'agentShareStatus' does not exist on type '{ topic: KeyFactory<[id: string]>; }'.",
  ]);
});

test('ignores an error that only moved to another line', () => {
  assert.deepEqual(newErrors(missingKey, missingKey.replace('(98,33)', '(120,7)')), []);
});

test('reports a repeat of an error the base has once', () => {
  const repeated = [missingKey, missingKey.replace('(98,33)', '(140,9)')].join('\n');

  assert.equal(newErrors(missingKey, repeated).length, 1);
});

test('fails a pull request that adds a type error', async (t) => {
  const { code, stdout } = await run(t, implicitAny, [implicitAny, missingKey].join('\n'));

  assert.equal(code, 1);
  assert.match(stdout, /agentShareStatus/);
  assert.doesNotMatch(stdout, /offset/);
});

test('passes a pull request whose only type errors exist on its base', async (t) => {
  const { code } = await run(t, missingKey, `$ tsrs --noEmit\n${missingKey}\n`);

  assert.equal(code, 0);
});

test('fails when the type check broke without reporting a type error', async (t) => {
  const { code } = await run(t, '', 'ERR_PNPM_FETCH_404 install failed');

  assert.equal(code, 1);
});

test('counts every error as new when the base produced no log', async (t) => {
  const { code } = await run(t, undefined, missingKey);

  assert.equal(code, 1);
});
