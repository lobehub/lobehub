import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkoutGitBranch, isInvalidBranchRef } from '../branches';
import { getGitAheadBehind, getGitBranch } from '../info';
import { pullGitBranch, pushGitBranch } from '../sync';
import { addGitWorktree } from '../worktrees';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const commit = async (dir: string, file: string, body: string) => {
  await writeFile(path.join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', `edit ${file}`);
};

const configure = (dir: string) => {
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
};

const cleanup: string[] = [];
const tempDir = async (prefix: string) => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
};

/**
 * A working repo on `main` that tracks a bare `origin`, plus a `feature` branch
 * (also tracking origin) one commit ahead of `main`.
 */
let repo: string;
let origin: string;

beforeEach(async () => {
  origin = await tempDir('lfs-origin-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '--bare', origin]);
  repo = await tempDir('lfs-repo-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: repo });
  configure(repo);
  await commit(repo, 'a.txt', 'hello\n');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-u', 'origin', 'main');
  git(repo, 'checkout', '-b', 'feature');
  await commit(repo, 'b.txt', 'feature\n');
  git(repo, 'push', '-u', 'origin', 'feature');
  git(repo, 'checkout', 'main');
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

/** Advance `branch` on origin by one commit from a throwaway clone. */
const advanceOnOrigin = async (branch: string) => {
  const clone = await tempDir('lfs-clone-');
  execFileSync('git', ['clone', '--branch', branch, origin, clone]);
  configure(clone);
  await commit(clone, 'c.txt', `${branch} upstream\n`);
  git(clone, 'push', 'origin', branch);
};

describe('isInvalidBranchRef', () => {
  it('rejects reflog / upstream syntax', () => {
    expect(isInvalidBranchRef('main@{upstream}')).toBe(true);
    expect(isInvalidBranchRef('lobehub/quiet-hill')).toBe(false);
  });
});

describe('checkoutGitBranch with a start point', () => {
  it('cuts the new branch from the start point, not HEAD, and echoes it', async () => {
    const result = await checkoutGitBranch({
      branch: 'lobehub/x',
      create: true,
      path: repo,
      startPoint: 'feature',
    });

    expect(result).toEqual({ startPoint: 'feature', success: true });
    expect(await getGitBranch(repo)).toMatchObject({ branch: 'lobehub/x' });
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'feature'));
  });

  it('carries uncommitted changes across, like a plain git checkout', async () => {
    await writeFile(path.join(repo, 'a.txt'), 'dirty\n');
    const result = await checkoutGitBranch({
      branch: 'lobehub/y',
      create: true,
      path: repo,
      startPoint: 'feature',
    });

    expect(result.success).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toContain('a.txt');
  });

  it('rejects a start point without a new branch', async () => {
    const result = await checkoutGitBranch({ branch: 'feature', path: repo, startPoint: 'main' });
    expect(result).toEqual({ error: 'A start point needs a new branch', success: false });
  });

  it('echoes nothing when no start point was asked for', async () => {
    expect(await checkoutGitBranch({ branch: 'z', create: true, path: repo })).toEqual({
      success: true,
    });
  });
});

describe('a start point sharing its name with a tag', () => {
  // The picker hands over a LOCAL branch; a same-named tag must not make git
  // refuse it as ambiguous.
  it('reads the local branch for both the checkout and the worktree', async () => {
    git(repo, 'tag', 'feature', 'main');

    expect(
      await checkoutGitBranch({ branch: 'mine', create: true, path: repo, startPoint: 'feature' }),
    ).toEqual({ startPoint: 'feature', success: true });
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'refs/heads/feature'));

    git(repo, 'checkout', 'main');
    const worktreePath = path.join(await tempDir('lfs-wt-'), 'tagged');
    const result = await addGitWorktree({
      branch: 'lobehub/tagged',
      path: repo,
      startPoint: 'feature',
      worktreePath,
    });
    expect(result).toMatchObject({ startPoint: 'feature', success: true });
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(
      git(repo, 'rev-parse', 'refs/heads/feature'),
    );
  });

  it('still takes a commit sha as given', async () => {
    const sha = git(repo, 'rev-parse', 'feature');
    expect(
      await checkoutGitBranch({ branch: 'from-sha', create: true, path: repo, startPoint: sha }),
    ).toEqual({ startPoint: sha, success: true });
  });
});

describe('addGitWorktree with a start point', () => {
  it('forks the worktree branch from the start point and echoes it', async () => {
    const worktreePath = path.join(await tempDir('lfs-wt-'), 'quiet-hill');
    const result = await addGitWorktree({
      branch: 'lobehub/quiet-hill',
      path: repo,
      startPoint: 'feature',
      worktreePath,
    });

    expect(result).toEqual({ startPoint: 'feature', success: true, worktreePath });
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'feature'));
    // The source checkout is untouched.
    expect(await getGitBranch(repo)).toMatchObject({ branch: 'main' });
  });
});

describe('getGitAheadBehind for a named branch', () => {
  it('counts the named branch against its own upstream while HEAD is elsewhere', async () => {
    await advanceOnOrigin('feature');
    // HEAD (main) is level with origin/main; feature is one behind origin/feature.
    expect(await getGitAheadBehind(repo, { branch: 'feature' })).toMatchObject({
      ahead: 0,
      behind: 1,
      branch: 'feature',
      hasUpstream: true,
      pushTarget: 'origin/feature',
      pushTargetExists: true,
      upstream: 'origin/feature',
    });
    expect(await getGitAheadBehind(repo)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('echoes the branch even when it tracks nothing', async () => {
    git(repo, 'branch', 'local-only');
    expect(await getGitAheadBehind(repo, { branch: 'local-only' })).toEqual({
      ahead: 0,
      behind: 0,
      branch: 'local-only',
      hasUpstream: false,
    });
  });
});

describe('pullGitBranch for a named branch', () => {
  it('fast-forwards a branch that is not checked out, without switching to it', async () => {
    await advanceOnOrigin('feature');
    git(repo, 'fetch', 'origin');
    const result = await pullGitBranch({ branch: 'feature', path: repo });

    expect(result).toEqual({ branch: 'feature', noop: false, success: true });
    expect(git(repo, 'rev-parse', 'feature')).toBe(git(repo, 'rev-parse', 'origin/feature'));
    expect(await getGitBranch(repo)).toMatchObject({ branch: 'main' });
  });

  it('reports a no-op when the branch is already level', async () => {
    expect(await pullGitBranch({ branch: 'feature', path: repo })).toEqual({
      branch: 'feature',
      noop: true,
      success: true,
    });
  });

  it('pulls the current branch the normal way', async () => {
    await advanceOnOrigin('main');
    const result = await pullGitBranch({ branch: 'main', path: repo });
    expect(result).toMatchObject({ branch: 'main', noop: false, success: true });
  });

  it('refuses a branch another worktree has checked out, naming that worktree', async () => {
    const worktreePath = path.join(await tempDir('lfs-wt-'), 'feature');
    git(repo, 'worktree', 'add', worktreePath, 'feature');
    const result = await pullGitBranch({ branch: 'feature', path: repo });

    expect(result).toMatchObject({
      branch: 'feature',
      reason: 'checkedOutElsewhere',
      success: false,
    });
    expect(await realpath(result.worktreePath!)).toBe(await realpath(worktreePath));
  });

  it('refuses a branch with no upstream', async () => {
    git(repo, 'branch', 'local-only');
    expect(await pullGitBranch({ branch: 'local-only', path: repo })).toMatchObject({
      branch: 'local-only',
      reason: 'noUpstream',
      success: false,
    });
  });

  it('rejects a non-fast-forward instead of rewriting the branch', async () => {
    await advanceOnOrigin('feature');
    git(repo, 'checkout', 'feature');
    await commit(repo, 'd.txt', 'diverged\n');
    git(repo, 'checkout', 'main');
    const local = git(repo, 'rev-parse', 'feature');

    const result = await pullGitBranch({ branch: 'feature', path: repo });
    expect(result).toMatchObject({ branch: 'feature', success: false });
    expect(git(repo, 'rev-parse', 'feature')).toBe(local);
  });
});

describe('pushGitBranch for a named branch', () => {
  it('pushes the named branch while HEAD is on another one', async () => {
    git(repo, 'checkout', 'feature');
    await commit(repo, 'e.txt', 'new work\n');
    git(repo, 'checkout', 'main');

    const result = await pushGitBranch({ branch: 'feature', path: repo });
    expect(result).toEqual({ branch: 'feature', noop: false, success: true });
    expect(git(origin, 'rev-parse', 'feature')).toBe(git(repo, 'rev-parse', 'feature'));
  });

  it('pushes a branch that shares its name with a tag', async () => {
    git(repo, 'tag', 'feature', 'main');
    git(repo, 'checkout', 'feature');
    await commit(repo, 'f.txt', 'tagged name\n');
    git(repo, 'checkout', 'main');

    expect(await pushGitBranch({ branch: 'feature', path: repo })).toMatchObject({
      branch: 'feature',
      success: true,
    });
    expect(git(origin, 'rev-parse', 'refs/heads/feature')).toBe(
      git(repo, 'rev-parse', 'refs/heads/feature'),
    );
  });
});
