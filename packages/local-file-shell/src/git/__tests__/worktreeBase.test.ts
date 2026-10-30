import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addGitWorktree, listGitWorktrees, resolveGitWorktreeBase } from '../worktrees';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const commit = async (cwd: string, name: string): Promise<string> => {
  await writeFile(path.join(cwd, name), `${name}\n`);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-m', name);
  return git(cwd, 'rev-parse', 'HEAD');
};

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
};

let repo: string;
let mainSha: string;
let featureSha: string;
const cleanup: string[] = [];

beforeEach(async () => {
  repo = await makeTempDir('lfs-wt-base-');
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: repo });
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  mainSha = await commit(repo, 'a.txt');
  git(repo, 'checkout', '-b', 'feat/source');
  featureSha = await commit(repo, 'b.txt');
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('resolveGitWorktreeBase', () => {
  it('defaults to the current branch and its commit', async () => {
    expect(await resolveGitWorktreeBase({ path: repo })).toEqual({
      base: { detached: false, ref: 'feat/source', sha: featureSha },
      success: true,
    });
  });

  it('reports a detached HEAD with no branch name', async () => {
    git(repo, 'checkout', '--detach', mainSha);

    const { base } = await resolveGitWorktreeBase({ path: repo });

    expect(base).toMatchObject({ detached: true, sha: mainSha });
    expect(base?.ref).toBeUndefined();
  });

  it('resolves a named ref', async () => {
    expect(await resolveGitWorktreeBase({ baseRef: 'main', path: repo })).toEqual({
      base: { detached: false, ref: 'main', sha: mainSha },
      success: true,
    });
  });

  it('prefers a branch over a same-named tag', async () => {
    git(repo, 'tag', 'main', featureSha);

    const { base } = await resolveGitWorktreeBase({ baseRef: 'main', path: repo });

    expect(base?.sha).toBe(mainSha);
  });

  it('still resolves a tag with no same-named branch', async () => {
    git(repo, 'tag', 'v1', mainSha);

    const { base } = await resolveGitWorktreeBase({ baseRef: 'v1', path: repo });

    expect(base?.sha).toBe(mainSha);
  });

  it.each(['--upload-pack=evil', 'a b', 'main..feat/source', 'main~1', ':/init'])(
    'rejects the malformed ref %s',
    async (baseRef) => {
      const result = await resolveGitWorktreeBase({ baseRef, path: repo });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid base ref');
    },
  );

  it('fails on a ref that does not exist', async () => {
    const result = await resolveGitWorktreeBase({ baseRef: 'no-such-ref', path: repo });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown base ref');
  });
});

describe('addGitWorktree base', () => {
  const add = async (baseRef?: string) => {
    const worktreePath = path.join(await makeTempDir('lfs-wt-target-'), 'wt');
    const result = await addGitWorktree({ baseRef, branch: 'wt/new', path: repo, worktreePath });
    return { result, worktreePath };
  };

  it('forks from the current HEAD by default', async () => {
    const { result, worktreePath } = await add();

    expect(result.success).toBe(true);
    expect(result.base).toEqual({ detached: false, ref: 'feat/source', sha: featureSha });
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(featureSha);
  });

  it('forks from an explicit base, not the current HEAD', async () => {
    const { result, worktreePath } = await add('main');

    expect(result.base).toEqual({ detached: false, ref: 'main', sha: mainSha });
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(mainSha);
  });

  it('accepts a commit sha as the base', async () => {
    const { result, worktreePath } = await add(mainSha);

    expect(result.success).toBe(true);
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(mainSha);
  });

  it('flags a detached HEAD base while still creating the worktree', async () => {
    git(repo, 'checkout', '--detach', mainSha);

    const { result, worktreePath } = await add();

    expect(result.success).toBe(true);
    expect(result.base).toMatchObject({ detached: true, sha: mainSha });
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(mainSha);
  });

  it('does not make a remote-tracking base the new branch upstream', async () => {
    git(repo, 'update-ref', 'refs/remotes/origin/main', mainSha);

    const { worktreePath } = await add('origin/main');

    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(mainSha);
    expect(git(repo, 'config', '--default', 'none', '--get', 'branch.wt/new.remote')).toBe('none');
  });

  it.each(['--orphan', 'no-such-ref'])(
    'refuses the base %s and creates nothing',
    async (baseRef) => {
      const { result, worktreePath } = await add(baseRef);

      expect(result.success).toBe(false);
      expect(git(repo, 'worktree', 'list')).not.toContain(worktreePath);
      expect(git(repo, 'branch', '--list', 'wt/new')).toBe('');
    },
  );
});

describe('listGitWorktrees fork point', () => {
  const forkPointOf = async (worktreePath: string) => {
    const worktrees = await listGitWorktrees(repo);
    const realPath = git(worktreePath, 'rev-parse', '--show-toplevel');
    return worktrees.find((worktree) => worktree.path === realPath)?.forkPoint;
  };

  /** A worktree made by plain git, as one predating this feature would be. */
  const legacyWorktree = async (branch: string, startPoint: string): Promise<string> => {
    const worktreePath = path.join(await makeTempDir('lfs-wt-legacy-'), 'wt');
    git(repo, 'worktree', 'add', '-b', branch, worktreePath, startPoint);
    return worktreePath;
  };

  it('marks a worktree forked at the default tip, falling back to local main', async () => {
    expect(await forkPointOf(await legacyWorktree('wt/tip', 'main'))).toEqual({
      atTip: true,
      defaultBranch: 'main',
      sha: mainSha,
    });
  });

  it('reports the older merge-base once the default branch has moved on', async () => {
    const worktreePath = await legacyWorktree('wt/old', 'main');
    git(repo, 'checkout', 'main');
    await commit(repo, 'c.txt');

    expect(await forkPointOf(worktreePath)).toEqual({
      atTip: false,
      defaultBranch: 'main',
      sha: mainSha,
    });
  });

  it('prefers the origin/HEAD default branch and drops the remote name', async () => {
    git(repo, 'update-ref', 'refs/remotes/origin/canary', featureSha);
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/canary');

    expect(await forkPointOf(await legacyWorktree('wt/canary', 'main'))).toEqual({
      atTip: false,
      defaultBranch: 'canary',
      sha: mainSha,
    });
  });

  it('omits the fork point for a checkout of the default branch itself', async () => {
    const worktreePath = await legacyWorktree('wt/other', 'main');
    git(repo, 'checkout', 'main');

    expect(await forkPointOf(repo)).toBeUndefined();
    expect(await forkPointOf(worktreePath)).toBeDefined();
  });

  it('omits the fork point when no default branch resolves', async () => {
    const worktreePath = await legacyWorktree('wt/none', 'main');
    git(repo, 'checkout', 'feat/source');
    git(repo, 'branch', '-m', 'main', 'trunk');

    expect(await forkPointOf(worktreePath)).toBeUndefined();
  });
});
