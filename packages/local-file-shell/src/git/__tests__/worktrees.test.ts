import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addGitWorktree, listGitWorktrees } from '../worktrees';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const commit = async (cwd: string, file: string): Promise<string> => {
  await writeFile(path.join(cwd, file), `${file}\n`);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', file);
  return git(cwd, 'rev-parse', 'HEAD');
};

/** Create an isolated temp repo on `main` with a single committed file. */
const initRepo = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lfs-worktrees-'));
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await commit(dir, 'a.txt');
  return dir;
};

let repo: string;
let parent: string;
const cleanup: string[] = [];

beforeEach(async () => {
  repo = await initRepo();
  parent = await mkdtemp(path.join(tmpdir(), 'lfs-worktrees-parent-'));
  cleanup.push(repo, parent);
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const target = (name: string) => path.join(parent, name);

describe('addGitWorktree base', () => {
  it('defaults the base to the current HEAD and names its branch', async () => {
    git(repo, 'checkout', '-b', 'feature');
    const head = await commit(repo, 'b.txt');

    const result = await addGitWorktree({
      branch: 'wt/one',
      path: repo,
      worktreePath: target('one'),
    });

    expect(result).toEqual({
      base: { ref: 'feature', sha: head },
      success: true,
      worktreePath: target('one'),
    });
    expect(git(target('one'), 'rev-parse', 'HEAD')).toBe(head);
  });

  it('forks from an explicit baseRef instead of the current HEAD', async () => {
    const mainTip = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-b', 'feature');
    await commit(repo, 'b.txt');

    const result = await addGitWorktree({
      baseRef: 'main',
      branch: 'wt/two',
      path: repo,
      worktreePath: target('two'),
    });

    expect(result).toMatchObject({ base: { ref: 'main', sha: mainTip }, success: true });
    expect(git(target('two'), 'rev-parse', 'HEAD')).toBe(mainTip);
    expect(git(target('two'), 'branch', '--show-current')).toBe('wt/two');
  });

  it('reports a SHA baseRef without a ref name', async () => {
    const first = git(repo, 'rev-parse', 'HEAD');
    await commit(repo, 'b.txt');

    const result = await addGitWorktree({
      baseRef: first.slice(0, 8),
      branch: 'wt/sha',
      path: repo,
      worktreePath: target('sha'),
    });

    expect(result).toMatchObject({ base: { sha: first }, success: true });
    expect(result.base?.ref).toBeUndefined();
  });

  it('flags a detached HEAD base instead of succeeding silently', async () => {
    const first = git(repo, 'rev-parse', 'HEAD');
    await commit(repo, 'b.txt');
    git(repo, 'checkout', '--detach', first);

    const result = await addGitWorktree({
      branch: 'wt/detached',
      path: repo,
      worktreePath: target('detached'),
    });

    expect(result).toEqual({
      base: { detached: true, sha: first },
      success: true,
      worktreePath: target('detached'),
    });
    expect(git(target('detached'), 'rev-parse', 'HEAD')).toBe(first);
  });

  it.each(['-x', 'main..feature', 'HEAD~1', 'a b', 'main:file'])(
    'rejects the malformed baseRef %j before running git',
    async (baseRef) => {
      const result = await addGitWorktree({
        baseRef,
        branch: 'wt/bad',
        path: repo,
        worktreePath: target('bad'),
      });

      expect(result).toEqual({ error: `Invalid base ref: ${baseRef}`, success: false });
      expect(git(repo, 'branch', '--list', 'wt/bad')).toBe('');
    },
  );

  it('rejects a baseRef that does not resolve to a commit', async () => {
    const result = await addGitWorktree({
      baseRef: 'no-such-branch',
      branch: 'wt/missing',
      path: repo,
      worktreePath: target('missing'),
    });

    expect(result).toEqual({ error: 'Unknown base ref: no-such-branch', success: false });
    expect(git(repo, 'branch', '--list', 'wt/missing')).toBe('');
  });

  it('keeps rejecting an invalid branch name', async () => {
    const result = await addGitWorktree({
      branch: '-b',
      path: repo,
      worktreePath: target('flag'),
    });

    expect(result).toEqual({ error: 'Invalid branch name: -b', success: false });
  });
});

describe('listGitWorktrees fork point', () => {
  it('reports the default branch tip and an older fork point for every checkout', async () => {
    const forkSha = git(repo, 'rev-parse', 'HEAD');
    await addGitWorktree({ branch: 'wt/old', path: repo, worktreePath: target('old') });
    await commit(target('old'), 'old.txt');

    const tip = await commit(repo, 'b.txt');
    await addGitWorktree({ branch: 'wt/new', path: repo, worktreePath: target('new') });

    const worktrees = await listGitWorktrees(repo);
    const byBranch = Object.fromEntries(worktrees.map((w) => [w.branch, w]));

    expect(byBranch.main.forkPoint).toEqual({ atTip: true, baseBranch: 'main', sha: tip });
    expect(byBranch['wt/new'].forkPoint).toEqual({ atTip: true, baseBranch: 'main', sha: tip });
    expect(byBranch['wt/old'].forkPoint).toEqual({
      atTip: false,
      baseBranch: 'main',
      sha: forkSha,
    });
  });

  it('computes the fork point against origin/HEAD when the repo has one', async () => {
    const remote = await mkdtemp(path.join(tmpdir(), 'lfs-worktrees-remote-'));
    cleanup.push(remote);
    execFileSync('git', ['clone', '--quiet', repo, remote]);
    const clone = await realpath(remote);
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'user.name', 'Test');
    git(clone, 'config', 'commit.gpgsign', 'false');
    const tip = git(clone, 'rev-parse', 'origin/main');

    await addGitWorktree({ branch: 'wt/clone', path: clone, worktreePath: target('clone') });
    await commit(target('clone'), 'c.txt');

    const worktree = (await listGitWorktrees(clone)).find((w) => w.branch === 'wt/clone');
    expect(worktree?.forkPoint).toEqual({ atTip: true, baseBranch: 'origin/main', sha: tip });
  });

  it('includes a fork point for a detached worktree', async () => {
    const first = git(repo, 'rev-parse', 'HEAD');
    await commit(repo, 'b.txt');
    git(repo, 'worktree', 'add', '--detach', target('detached'), first);

    const worktree = (await listGitWorktrees(repo)).find((w) => w.detached);
    expect(worktree?.forkPoint).toEqual({ atTip: false, baseBranch: 'main', sha: first });
  });
});
