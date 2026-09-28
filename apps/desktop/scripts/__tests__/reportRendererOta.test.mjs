import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyResult } from '../reportRendererOta.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../reportRendererOta.mjs', import.meta.url));
let root;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const base = { outcome: 'success', outputs: { found: 'true', shell_abi: 'a'.repeat(64) } };
const gate = { outcome: 'success', outputs: { allowed: 'true', shell_abi: 'a'.repeat(64) } };
const version = { outcome: 'success', outputs: { seq: '4', version: '1.0.0-core.4' } };

describe('classifyResult', () => {
  it('requests a full release only for a successfully evaluated compatibility decision', () => {
    expect(
      classifyResult({
        base,
        gate: { outcome: 'success', outputs: { allowed: 'false', reason: 'abi-changed' } },
      }),
    ).toMatchObject({ outcome: 'skipped', reason: 'abi-changed', requiresFullRelease: true });
    expect(classifyResult({ base, gate: { outcome: 'failure' } })).toMatchObject({
      reason: 'abi-compute-failed',
      requiresFullRelease: false,
    });
    expect(classifyResult({ base: { outcome: 'failure' } })).toMatchObject({
      reason: 'base-fetch-failed',
      requiresFullRelease: false,
    });
    expect(
      classifyResult({ base: { outcome: 'failure', outputs: { reason: 'base-invalid' } } }),
    ).toMatchObject({ reason: 'base-invalid', requiresFullRelease: false });
    expect(
      classifyResult({
        base: { outcome: 'success', outputs: { found: 'false', reason: 'base-missing' } },
        gate: { outcome: 'success', outputs: { allowed: 'false', reason: 'abi-changed' } },
      }),
    ).toMatchObject({ reason: 'base-missing', requiresFullRelease: true });
    expect(classifyResult({ base, gate, version })).toMatchObject({
      outcome: 'gated',
      reason: 'core-allowed',
      requiresFullRelease: false,
    });
  });

  it.each([
    ['setup', 'environment-setup-failed'],
    ['build', 'core-build-failed'],
    ['core', 'core-release-failed'],
    ['upload', 'artifact-upload-failed'],
  ])('retains core-build %s failure', (stage, reason) => {
    expect(classifyResult({ [stage]: { outcome: 'failure' } }, 'core-build')).toMatchObject({
      reason,
      outcome: 'failed',
      published: false,
      requiresFullRelease: false,
    });
  });

  it('reports unchanged cores as skipped and uploaded cores as built', () => {
    expect(
      classifyResult({ core: { outcome: 'success', outputs: { skipped: 'true' } } }, 'core-build'),
    ).toMatchObject({ outcome: 'skipped', reason: 'core-unchanged' });
    expect(
      classifyResult(
        {
          core: { outcome: 'success', outputs: { skipped: 'false' } },
          upload: { outcome: 'success' },
        },
        'core-build',
      ),
    ).toMatchObject({ outcome: 'built', reason: 'core-ready' });
  });

  it('distinguishes cancellation, prepared artifacts and actual publication', () => {
    expect(classifyResult({ base, gate, version: { outcome: 'cancelled' } })).toMatchObject({
      reason: 'cancelled',
      published: false,
      requiresFullRelease: false,
    });
    expect(classifyResult({ upload: { outcome: 'success' } }, 'build')).toMatchObject({
      outcome: 'built',
      published: false,
    });
    expect(
      classifyResult(
        { base: { outcome: 'success', outputs: { reason: 'upload-not-configured' } } },
        'release',
      ),
    ).toMatchObject({ reason: 'upload-not-configured', published: false });
    expect(
      classifyResult({ base: { outcome: 'success', outputs: { published: 'true' } } }, 'release'),
    ).toMatchObject({ published: true });
    expect(
      classifyResult(
        {
          collect: { outcome: 'success', outputs: { skipped: 'false' } },
          publish: { outcome: 'success', outputs: { published: 'true' } },
        },
        'core-publish',
      ),
    ).toMatchObject({ published: true, reason: 'published' });
    expect(
      classifyResult(
        { collect: { outcome: 'success', outputs: { skipped: 'true' } } },
        'core-publish',
      ),
    ).toMatchObject({ outcome: 'skipped', reason: 'core-unchanged' });
    expect(classifyResult({ publish: { outcome: 'failure' } }, 'core-publish')).toMatchObject({
      outcome: 'failed',
      reason: 'upload-failed',
    });
  });

  it('writes CLI evidence after setup failure without exposing unrelated outputs or secrets', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ota-diagnostics-'));
    await mkdir(path.join(root, 'apps/desktop/release'), { recursive: true });
    await writeFile(path.join(root, 'apps/desktop/package.json'), '{"version":"1.0.0"}');
    await writeFile(path.join(root, 'apps/desktop/pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const output = path.join(root, 'github-output');
    const summary = path.join(root, 'github-summary');
    await exec('node', [script], {
      cwd: root,
      env: {
        ...process.env,
        DIAGNOSTIC_KIND: 'core-build',
        CHANNEL: 'canary',
        GITHUB_SHA: 'fixture-commit',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        RENDERER_OTA_PRIVATE_KEY: 'NEVER-LOG-THIS-PRIVATE-KEY',
        STEPS_JSON: JSON.stringify({
          setup: { outcome: 'failure', outputs: { token: 'NEVER-LOG-THIS-TOKEN' } },
        }),
      },
    });
    const data = await readFile(path.join(root, 'desktop-ota-diagnostics/result.json'), 'utf8');
    expect(JSON.parse(data)).toMatchObject({
      reason: 'environment-setup-failed',
      commit: 'fixture-commit',
      runId: '123',
      lockSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(data).not.toContain('NEVER-LOG');
    expect(await readFile(output, 'utf8')).toContain('requires_full_release=false');
    expect(await readFile(summary, 'utf8')).toContain('environment-setup-failed');
  });
});
