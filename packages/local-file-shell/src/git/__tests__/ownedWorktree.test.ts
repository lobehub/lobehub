import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupOwnedWorktree,
  countUncommittedFiles,
  restoreOwnedWorktree,
} from '../ownedWorktree';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const cleanup: string[] = [];
const tempDir = async (prefix: string) => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
};

const initRepo = async (dir: string) => {
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'a.txt'), 'hello\n');
  await writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
};

let repo: string;
let root: string;
let worktree: string;
const BRANCH = 'lobehub/quiet-hill';

const addWorktree = (target: string, branch = BRANCH) =>
  git(repo, 'worktree', 'add', '-b', branch, target);

beforeEach(async () => {
  repo = await tempDir('owt-repo-');
  await initRepo(repo);
  root = path.join(await tempDir('owt-home-'), '.lobehub', 'worktrees');
  worktree = path.join(root, 'repo-1a2b3c4d', 'quiet-hill');
  await mkdir(path.dirname(worktree), { recursive: true });
  addWorktree(worktree);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const run = (params: { discard?: boolean; worktreePath?: string } = {}) =>
  cleanupOwnedWorktree({
    discard: params.discard,
    rootDir: root,
    sourcePath: repo,
    worktreePath: params.worktreePath ?? worktree,
  });

const branches = () => git(repo, 'branch', '--format=%(refname:short)').split('\n');

describe('cleanupOwnedWorktree — clean / dirty', () => {
  it('removes a clean worktree, prunes it, and keeps the branch', async () => {
    await expect(run()).resolves.toEqual({ branch: BRANCH, outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(worktree);
    expect(branches()).toContain(BRANCH);
  });

  it('does not count ignored files or unpushed commits as dirty', async () => {
    await mkdir(path.join(worktree, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(worktree, 'node_modules', 'pkg', 'index.js'), 'x');
    await writeFile(path.join(worktree, 'b.txt'), 'committed\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-m', 'unpushed');

    await expect(run()).resolves.toMatchObject({ outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'log', '--format=%s', '-1', BRANCH)).toBe('unpushed');
  });

  it('keeps a worktree with tracked changes and counts them', async () => {
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await expect(run()).resolves.toEqual({ branch: BRANCH, dirtyFiles: 1, outcome: 'dirty' });
    expect(existsSync(worktree)).toBe(true);
  });

  it('keeps a worktree with untracked files, counting each file', async () => {
    await mkdir(path.join(worktree, 'new'), { recursive: true });
    await writeFile(path.join(worktree, 'new', 'one.txt'), '1');
    await writeFile(path.join(worktree, 'new', 'two.txt'), '2');
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await expect(run()).resolves.toMatchObject({ dirtyFiles: 3, outcome: 'dirty' });
  });

  it('counts a staged rename once', async () => {
    git(worktree, 'mv', 'a.txt', 'renamed.txt');
    await expect(countUncommittedFiles(worktree)).resolves.toBe(1);
  });

  it('discard removes a dirty worktree, ignored files included, and keeps the branch', async () => {
    await writeFile(path.join(worktree, 'a.txt'), 'changed\n');
    await writeFile(path.join(worktree, 'untracked.txt'), 'u');
    await mkdir(path.join(worktree, 'node_modules'), { recursive: true });
    await writeFile(path.join(worktree, 'node_modules', 'x.js'), 'x');

    await expect(run({ discard: true })).resolves.toMatchObject({ outcome: 'removed' });
    expect(existsSync(worktree)).toBe(false);
    expect(branches()).toContain(BRANCH);
  });

  it('reports a locked worktree and leaves it', async () => {
    git(repo, 'worktree', 'lock', worktree);
    await expect(run()).resolves.toEqual({ branch: BRANCH, outcome: 'locked' });
    await expect(run({ discard: true })).resolves.toMatchObject({ outcome: 'locked' });
    expect(existsSync(worktree)).toBe(true);
  });

  it('treats a folder that is already gone as removed and prunes its registration', async () => {
    await rm(worktree, { force: true, recursive: true });
    await expect(run()).resolves.toEqual({ outcome: 'removed' });
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(worktree);
  });
});

describe('cleanupOwnedWorktree — path guard', () => {
  it('refuses a relative path and `..` traversal out of the root', async () => {
    await expect(run({ worktreePath: 'repo/quiet-hill' })).resolves.toMatchObject({
      outcome: 'refused',
    });
    await expect(
      run({ worktreePath: path.join(root, '..', '..', path.basename(repo)) }),
    ).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(repo)).toBe(true);
  });

  it('refuses a worktree outside the root even when git lists it', async () => {
    const outside = path.join(await tempDir('owt-outside-'), 'wt');
    addWorktree(outside, 'lobehub/outside');
    await expect(run({ worktreePath: outside })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses a symlink inside the root that escapes it', async () => {
    const outside = path.join(await tempDir('owt-outside-'), 'wt');
    addWorktree(outside, 'lobehub/outside');
    const link = path.join(root, 'repo-1a2b3c4d', 'escape');
    await symlink(outside, link);

    await expect(run({ worktreePath: link })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses a folder in the root that the source repo does not list', async () => {
    const stray = path.join(root, 'repo-1a2b3c4d', 'stray');
    await mkdir(stray, { recursive: true });
    await writeFile(path.join(stray, 'keep.txt'), 'x');

    await expect(run({ worktreePath: stray })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(path.join(stray, 'keep.txt'))).toBe(true);
  });

  it('refuses a worktree of another repository', async () => {
    const other = await tempDir('owt-other-');
    await initRepo(other);
    const foreign = path.join(root, 'other-00000000', 'x');
    await mkdir(path.dirname(foreign), { recursive: true });
    git(other, 'worktree', 'add', '-b', 'lobehub/x', foreign);

    await expect(run({ worktreePath: foreign })).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(foreign)).toBe(true);
  });

  it('refuses the main worktree', async () => {
    // A source repo cloned under the root: the path guard alone would pass.
    const mainUnderRoot = path.join(root, 'main-repo');
    await mkdir(mainUnderRoot, { recursive: true });
    await initRepo(mainUnderRoot);

    await expect(
      cleanupOwnedWorktree({
        rootDir: root,
        sourcePath: mainUnderRoot,
        worktreePath: mainUnderRoot,
      }),
    ).resolves.toMatchObject({ outcome: 'refused' });
    expect(existsSync(path.join(mainUnderRoot, '.git'))).toBe(true);
  });
});

describe('restoreOwnedWorktree', () => {
  it('checks the branch out again at the original path', async () => {
    await writeFile(path.join(worktree, 'b.txt'), 'kept on branch\n');
    git(worktree, 'add', 'b.txt');
    git(worktree, 'commit', '-m', 'work');
    await run();
    expect(existsSync(worktree)).toBe(false);

    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'restored' });
    expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
    expect(existsSync(path.join(worktree, 'b.txt'))).toBe(true);
  });

  it('is a no-op when the worktree is already there on its branch', async () => {
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'restored' });
  });

  it('reports a deleted branch without creating anything', async () => {
    await run();
    git(repo, 'branch', '-D', BRANCH);
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: worktree,
      }),
    ).resolves.toEqual({ outcome: 'branchMissing' });
    expect(existsSync(worktree)).toBe(false);
  });

  it('refuses a path outside the root', async () => {
    await expect(
      restoreOwnedWorktree({
        branch: BRANCH,
        rootDir: root,
        sourcePath: repo,
        worktreePath: path.join(path.dirname(root), 'elsewhere'),
      }),
    ).resolves.toMatchObject({ outcome: 'refused' });
  });
});
