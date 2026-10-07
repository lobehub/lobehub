import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workflow = await readFile(
  new URL('../workflows/release-desktop-stable.yml', import.meta.url),
  'utf8',
);
const step = workflow.split('      - name: Resolve Cloud revision\n')[1].split('\n  #')[0];
const script = step.split('        run: |\n')[1].replaceAll(/^ {10}/gm, '');
const sha = 'a'.repeat(40);

async function resolveRef(requested, remote = sha) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stable-cloud-ref-'));
  const output = path.join(dir, 'output');
  try {
    const result = await execFileAsync(
      'bash',
      [
        '-c',
        `
      git() { echo remote-called >&2; printf '%s\\tHEAD\\n' "$REMOTE_SHA"; }
      ${script}
    `,
      ],
      {
        env: {
          ...process.env,
          CLOUD_REPOSITORY: 'example/overlay',
          CLOUD_TOKEN: 'test-token',
          GITHUB_OUTPUT: output,
          REMOTE_SHA: remote,
          REQUESTED_CLOUD_REF: requested,
        },
      },
    );
    return { ...result, output: await readFile(output, 'utf8') };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

test('explicit commit pins Cloud without looking up HEAD', async () => {
  assert.match(step, /REQUESTED_CLOUD_REF: \$\{\{ inputs.cloud_ref/);
  const result = await resolveRef(sha);
  assert.equal(result.output, `cloud_ref=${sha}\n`);
  assert.equal(result.stderr, '');
});

test('empty input resolves Cloud HEAD', async () => {
  const result = await resolveRef('');
  assert.equal(result.output, `cloud_ref=${sha}\n`);
  assert.match(result.stderr, /remote-called/);
});

test('invalid explicit refs fail before remote lookup', async () => {
  for (const ref of ['main', 'abc123', 'A'.repeat(40), '$(touch /tmp/invalid-ref)']) {
    await assert.rejects(resolveRef(ref), (error) => {
      assert.match(error.stdout, /cloud_ref must be a full/);
      assert.equal(error.stderr, '');
      return true;
    });
  }
});

test('invalid remote HEAD fails instead of emitting a revision', async () => {
  await assert.rejects(resolveRef('', 'invalid'), /Unable to resolve Cloud revision/);
});
