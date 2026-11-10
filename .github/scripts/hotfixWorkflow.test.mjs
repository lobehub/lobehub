import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Runs after setup/install: the operator CLI imports workspace prompt dependencies.
test('hotfix help explains explicit baseline selection without accessing Git or GitHub', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hotfix-help-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../scripts/hotfixWorkflow/index.ts', import.meta.url));
  const result = await exec(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script, '--help'],
    { cwd: root },
  );
  assert.match(result.stdout, /--base/);
  assert.match(result.stdout, /--cloud-ref/);
});
