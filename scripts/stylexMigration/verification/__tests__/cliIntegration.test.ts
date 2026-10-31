// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { git } from '../source/git';
import { resolveCommit } from '../source/revisionResolver';

const runner = path.resolve(import.meta.dirname, '../run.ts');
const owned: string[] = [];
const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-cli-test-'));
  owned.push(root);
  await git(root, ['init', '-b', 'canary']);
  await git(root, ['config', 'user.name', 'Verifier test']);
  await git(root, ['config', 'user.email', 'verifier@example.invalid']);
  await writeFile(path.join(root, 'component.ts'), 'export const x = 1;');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'initial']);
  const base = await resolveCommit(root, 'HEAD');
  await writeFile(path.join(root, 'component.ts'), 'export const x = 2;');
  await git(root, ['commit', '-am', 'candidate']);
  return { base, root };
};
const run = (root: string, args: string[]) =>
  new Promise<{ code: number; stderr: string; stdout: string }>((resolve, reject) => {
    execFile(
      'bun',
      [runner, '--repository', root, '--output', path.join(root, 'evidence'), ...args],
      {
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        maxBuffer: 2 * 1024 ** 2,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (!error) resolve({ code: 0, stderr, stdout });
        else if (typeof error.code === 'number') resolve({ code: error.code, stderr, stdout });
        else reject(error);
      },
    );
  });
const artifact = async (root: string, file = 'preflight.json') => {
  const parent = path.join(root, 'evidence');
  const entries = await readdir(parent);
  expect(entries).toHaveLength(1);
  return JSON.parse(await readFile(path.join(parent, entries[0], file), 'utf8'));
};

afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('real Node CLI process exit contract', () => {
  it('returns 2 for a partial plan instead of a successful empty comparison', async () => {
    const { root, base } = await setup();
    expect((await run(root, ['--base', base, '--head', 'HEAD', '--plan-only'])).code).toBe(2);
    expect(await artifact(root)).toMatchObject({
      gateEligible: false,
      mode: 'preflight',
      status: 'NEEDS_REVIEW',
    });
  });

  it('exports isolated source snapshots but stays blocked until dependencies and binding are proven', async () => {
    const { root, base } = await setup();
    expect((await run(root, ['--base', base, '--head', 'HEAD'])).code).toBe(2);
    const result = await artifact(root);
    expect(result.snapshots.base.fileCount).toBe(1);
    expect(result.snapshots.candidate.dependencyRestore).toBe('NOT_RESTORED');
    expect(result.reasonCodes).toContain('BROWSER_VERIFICATION_NOT_RUN');
    expect(await artifact(root, 'source-cleanup.json')).toMatchObject({
      removed: ['base-source', 'candidate-source'],
    });
  });

  it('retains source exports only on an explicit debugging request', async () => {
    const { root, base } = await setup();
    expect((await run(root, ['--base', base, '--head', 'HEAD', '--keep-sources'])).code).toBe(2);
    const result = await artifact(root);
    expect(
      await readFile(path.join(result.snapshots.base.directory, 'component.ts'), 'utf8'),
    ).toContain('1');
  });

  it('uses exit 4 only for a proven identical candidate tree, not a fake PASS', async () => {
    const { root } = await setup();
    expect((await run(root, ['--base', 'HEAD', '--head', 'HEAD'])).code).toBe(4);
    expect(await artifact(root)).toMatchObject({
      gateEligible: false,
      status: 'NOT_APPLICABLE',
      reasonCodes: ['NO_STYLE_IMPACT'],
    });
  });

  it('keeps even an empty plan non-gating', async () => {
    const { root } = await setup();
    expect((await run(root, ['--base', 'HEAD', '--head', 'HEAD', '--plan-only'])).code).toBe(2);
  });

  it('returns 3 and records an error when a revision cannot be resolved', async () => {
    const { root } = await setup();
    expect((await run(root, ['--base', 'missing-ref', '--head', 'HEAD'])).code).toBe(3);
    expect(await artifact(root, 'error.json')).toMatchObject({
      gateEligible: false,
      status: 'ERROR',
    });
  });

  it('rejects invalid and unsupported options without a success result', async () => {
    const { root } = await setup();
    expect((await run(root, ['--pr', '21447', '--base', 'HEAD'])).code).toBe(3);
    expect((await run(root, ['batch'])).code).toBe(3);
    expect((await run(root, ['--unknown'])).code).toBe(3);
    expect(
      (await run(root, ['--base', 'HEAD', '--head', 'HEAD', '--fixture-dependencies'])).code,
    ).toBe(3);
    expect(
      (await run(root, ['--base', 'HEAD', '--head', 'HEAD', '--dependency-network'])).code,
    ).toBe(3);
    expect(
      (await run(root, ['--base', 'HEAD', '--head', 'HEAD', '--fixture', 'LiteTable'])).code,
    ).toBe(3);
    expect(
      (
        await run(root, [
          '--base',
          'HEAD',
          '--head',
          'HEAD',
          '--plan-only',
          '--restore-dependencies',
        ])
      ).code,
    ).toBe(3);
  });

  it('rejects ambiguous or invalid fixture batches before source or dependency work', async () => {
    const { root } = await setup();
    for (const selection of ['', 'DotsLoading,DotsLoading', 'DotsLoading,Unknown', '../escape']) {
      const result = await run(root, [
        '--base',
        'HEAD',
        '--head',
        'HEAD',
        '--restore-dependencies',
        '--fixtures',
        selection,
      ]);
      expect(result.code).toBe(3);
    }
    expect((await run(root, ['--fixture', 'LiteTable', '--fixtures', 'DotsLoading'])).code).toBe(3);
    expect((await run(root, ['--fixtures', 'DotsLoading,UnreadDot'])).code).toBe(3);
  });
});
