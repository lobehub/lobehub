import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { parse } from 'yaml';

const loadSteps = async () =>
  parse(
    await readFile(new URL('../actions/desktop-publish-s3/action.yml', import.meta.url), 'utf8'),
  ).runs.steps;

/** A fake `aws` that fails its first FAIL_TIMES calls the way R2 rejected the 2.3.2-canary.2 dmg. */
const FAKE_AWS = `#!/usr/bin/env node
const fs = require('fs');
const count = (fs.existsSync(process.env.AWS_COUNT) ? Number(fs.readFileSync(process.env.AWS_COUNT, 'utf8')) : 0) + 1;
fs.writeFileSync(process.env.AWS_COUNT, String(count));
fs.appendFileSync(process.env.AWS_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
if (count <= Number(process.env.FAIL_TIMES || 0)) {
  console.error('An error occurred (InvalidPart) when calling the CompleteMultipartUpload operation');
  process.exit(1);
}
`;

const runInstallers = async (root, script, failTimes) => {
  const calls = path.join(root, `calls-${failTimes}.jsonl`);
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AWS_CALLS: calls,
      AWS_COUNT: path.join(root, `count-${failTimes}`),
      CHANNEL: 'canary',
      FAIL_TIMES: String(failTimes),
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      S3_BUCKET: 'fixture',
      S3_ENDPOINT: 'https://r2.example',
      VERSION: '2.3.2-canary.2',
    },
  });
  const uploads = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  return { result, uploads };
};

test('installers upload before the core and shell.json, manifests only after them', async () => {
  const ids = (await loadSteps()).map((step) => step.id);
  const at = (id) => ids.indexOf(id);
  assert.ok(at('installers') !== -1 && at('base') !== -1 && at('manifests') !== -1);
  assert.ok(at('installers') < at('base'), 'installers must precede the core publish');
  assert.ok(at('base') < at('manifests'), 'manifests must follow the core publish');
});

test('an installer upload rejected by R2 is retried as a whole file, up to three attempts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-publish-s3-'));
  try {
    await mkdir(path.join(root, 'bin'));
    await mkdir(path.join(root, 'release'));
    await writeFile(path.join(root, 'bin/aws'), FAKE_AWS);
    // Skip the real backoff so the test stays fast.
    await writeFile(path.join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(path.join(root, 'bin/aws'), 0o755);
    await chmod(path.join(root, 'bin/sleep'), 0o755);
    await writeFile(path.join(root, 'release/LobeHub-2.3.2-canary.2-arm64.dmg'), 'dmg');
    const { run } = (await loadSteps()).find((step) => step.id === 'installers');
    const target = 's3://fixture/canary/2.3.2-canary.2/LobeHub-2.3.2-canary.2-arm64.dmg';

    const recovered = await runInstallers(root, run, 2);
    assert.equal(recovered.result.status, 0, recovered.result.stderr);
    assert.equal(recovered.uploads.length, 3);
    for (const args of recovered.uploads)
      assert.deepEqual(args, [
        's3',
        'cp',
        'release/LobeHub-2.3.2-canary.2-arm64.dmg',
        target,
        '--endpoint-url',
        'https://r2.example',
      ]);

    const exhausted = await runInstallers(root, run, 3);
    assert.notEqual(exhausted.result.status, 0);
    assert.equal(exhausted.uploads.length, 3);
    assert.match(exhausted.result.stdout, /failed after 3 attempts/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
