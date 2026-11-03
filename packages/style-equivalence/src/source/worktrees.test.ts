import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareRevisions } from './worktrees';

let repo: string;
let runDir: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'style-eq-wt-'));
  runDir = await mkdtemp(path.join(tmpdir(), 'style-eq-run-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  await writeFile(path.join(repo, 'package.json'), '{"dependencies":{"a":"1.0.0"}}\n');
  await writeFile(path.join(repo, 'index.tsx'), 'export const A = 1;\n');
  await mkdir(path.join(repo, 'node_modules'));
  git('add', 'package.json', 'index.tsx');
  git('commit', '-qm', 'base');
});

afterEach(async () => {
  await rm(repo, { force: true, recursive: true });
  await rm(runDir, { force: true, recursive: true });
});

const worktreeList = () => git('worktree', 'list', '--porcelain');

describe('prepareRevisions', () => {
  it('shares the checkout dependencies when manifests are unchanged and cleans up', async () => {
    await writeFile(path.join(repo, 'index.tsx'), 'export const A = 2;\n');
    git('commit', '-qam', 'head');
    const installs: string[] = [];
    const revisions = await prepareRevisions({
      base: 'HEAD~1',
      head: 'HEAD',
      install: async (root) => void installs.push(root),
      repo,
      runDir,
    });
    expect(revisions.dependencyMode).toBe('shared');
    expect(installs).toEqual([]);
    expect(await readlink(path.join(revisions.head.root, 'node_modules'))).toBe(
      path.join(repo, 'node_modules'),
    );
    expect(worktreeList()).toContain(revisions.base.root);
    await revisions.cleanup();
    expect(worktreeList()).not.toContain(revisions.base.root);
    expect(worktreeList()).not.toContain(revisions.head.root);
  });

  it("shares each workspace package's own dependencies too", async () => {
    await mkdir(path.join(repo, 'packages/runtime/node_modules'), { recursive: true });
    await writeFile(path.join(repo, 'packages/runtime/package.json'), '{"name":"runtime"}\n');
    git('add', 'packages/runtime/package.json');
    git('commit', '-qm', 'workspace');
    await writeFile(path.join(repo, 'index.tsx'), 'export const A = 3;\n');
    git('commit', '-qam', 'head');
    const revisions = await prepareRevisions({
      base: 'HEAD~1',
      head: 'HEAD',
      install: async () => undefined,
      repo,
      runDir,
    });
    expect(await readlink(path.join(revisions.base.root, 'packages/runtime/node_modules'))).toBe(
      path.join(repo, 'packages/runtime/node_modules'),
    );
    await revisions.cleanup();
  });

  it('installs each side separately when a manifest changed', async () => {
    await writeFile(path.join(repo, 'package.json'), '{"dependencies":{"a":"2.0.0"}}\n');
    git('commit', '-qam', 'head');
    const installs: string[] = [];
    const revisions = await prepareRevisions({
      base: 'HEAD~1',
      head: 'HEAD',
      install: async (root) => void installs.push(root),
      repo,
      runDir,
    });
    expect(revisions.dependencyMode).toBe('isolated');
    expect(installs.sort()).toEqual([revisions.base.root, revisions.head.root].sort());
    expect(
      (
        await lstat(path.join(revisions.base.root, 'node_modules')).catch(() => undefined)
      )?.isSymbolicLink(),
    ).not.toBe(true);
    await revisions.cleanup();
  });

  it('removes created worktrees when preparation fails', async () => {
    await expect(
      prepareRevisions({ base: 'HEAD', head: 'does-not-exist', repo, runDir }),
    ).rejects.toThrow();
    expect(
      worktreeList()
        .split('\n')
        .filter((line) => line.startsWith('worktree ')),
    ).toHaveLength(1);
  });
});
