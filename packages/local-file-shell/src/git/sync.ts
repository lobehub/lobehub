import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import { isInvalidBranchRef } from './branches';
import type { GitPullResult, GitPushResult } from './types';
import { parseGitWorktreeList } from './worktrees';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

const stderrOf = (error: any, fallback: string): string =>
  (error?.stderr ?? error?.message ?? '').toString().trim() || fallback;

const readGit = async (args: string[], cwd: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 5000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
};

/** The branch HEAD is on, or undefined when detached / unreadable. */
const readCurrentBranch = (dirPath: string) =>
  readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], dirPath);

const readBranchSha = (dirPath: string, branch: string) =>
  readGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], dirPath);

/** The worktree that has `branch` checked out, other than `dirPath`'s own. */
const findOtherWorktreeHolding = async (
  dirPath: string,
  branch: string,
): Promise<string | undefined> => {
  const stdout = await readGit(['worktree', 'list', '--porcelain', '-z'], dirPath);
  if (!stdout) return undefined;
  return parseGitWorktreeList(stdout).find(
    (worktree) => worktree.branch === branch && !worktree.bare && !worktree.prunable,
  )?.path;
};

/** `{ remote, ref }` the branch pulls from, e.g. `{ remote: 'origin', ref: 'refs/heads/main' }`. */
const readUpstream = async (
  dirPath: string,
  branch: string,
): Promise<{ ref: string; remote: string } | undefined> => {
  const stdout = await readGit(
    [
      'for-each-ref',
      '--format=%(upstream:remotename)%09%(upstream:remoteref)',
      `refs/heads/${branch}`,
    ],
    dirPath,
  );
  const [remote, ref] = (stdout?.split('\n')[0] ?? '').split('\t');
  return remote && ref ? { ref, remote } : undefined;
};

const pullHead = async (dirPath: string): Promise<GitPullResult> => {
  try {
    const { stdout } = await execFileAsync('git', ['pull', '--ff-only'], {
      cwd: dirPath,
      timeout: 60_000,
    });
    const noop = /Already up to date/i.test(stdout);
    return { noop, success: true };
  } catch (error: any) {
    const stderr = stderrOf(error, 'git pull failed');
    log.debug('[pullGitBranch] failed', { stderr });
    return { error: stderr, success: false };
  }
};

/**
 * Fast-forward a branch from its upstream.
 *
 * Without `branch` this is the historical HEAD pull (`git pull --ff-only`).
 * With one, the named branch is updated without switching to it:
 * `git fetch <remote> <upstream>:<branch>` — a refspec without `+` only ever
 * fast-forwards. That is refused by git for a branch another worktree has
 * checked out, so that case is reported up front as `checkedOutElsewhere`
 * instead of git's terse refusal. A branch HEAD is on is pulled the normal way.
 * The branch is echoed back so a caller can tell an older device, which
 * ignores the field and pulls HEAD, from one that honoured it.
 */
export const pullGitBranch = async (payload: {
  branch?: string;
  path: string;
}): Promise<GitPullResult> => {
  const { path: dirPath, branch } = payload;
  if (branch === undefined) return pullHead(dirPath);
  if (!branch.trim() || isInvalidBranchRef(branch))
    return { error: `Invalid branch name: ${branch}`, success: false };

  if ((await readCurrentBranch(dirPath)) === branch) {
    return { ...(await pullHead(dirPath)), branch };
  }

  const holder = await findOtherWorktreeHolding(dirPath, branch);
  if (holder) {
    return {
      branch,
      error: `Branch ${branch} is checked out at ${holder}; pull it there`,
      reason: 'checkedOutElsewhere',
      success: false,
      worktreePath: holder,
    };
  }

  const upstream = await readUpstream(dirPath, branch);
  if (!upstream) {
    return {
      branch,
      error: `Branch ${branch} has no upstream to pull from`,
      reason: 'noUpstream',
      success: false,
    };
  }

  const before = await readBranchSha(dirPath, branch);
  try {
    await execFileAsync(
      'git',
      ['fetch', '--no-tags', upstream.remote, `${upstream.ref}:refs/heads/${branch}`],
      { cwd: dirPath, timeout: 60_000 },
    );
  } catch (error: any) {
    const stderr = stderrOf(error, 'git fetch failed');
    log.debug('[pullGitBranch] fetch failed', { branch, stderr });
    return { branch, error: stderr, success: false };
  }
  const after = await readBranchSha(dirPath, branch);
  return { branch, noop: !!before && before === after, success: true };
};

/**
 * Push a branch to its same-named remote on `origin`.
 *
 * Without `branch` this is the historical `git push -u origin HEAD`, which works
 * even when the local branch name differs from the configured upstream. With
 * one, `git push -u origin <branch>` pushes that branch from wherever HEAD is —
 * pushing never needs a checkout. The branch is echoed back on success, like
 * {@link pullGitBranch}.
 */
export const pushGitBranch = async (payload: {
  branch?: string;
  path: string;
}): Promise<GitPushResult> => {
  const { path: dirPath, branch } = payload;
  if (branch !== undefined && (!branch.trim() || isInvalidBranchRef(branch)))
    return { error: `Invalid branch name: ${branch}`, success: false };

  // A named branch is spelled as its full ref: a tag sharing the name would
  // otherwise make the refspec match more than one source.
  const refspec = branch ? `refs/heads/${branch}` : 'HEAD';
  try {
    const { stderr } = await execFileAsync('git', ['push', '-u', 'origin', refspec], {
      cwd: dirPath,
      timeout: 60_000,
    });
    // git push writes progress/status to stderr even on success
    const noop = /Everything up-to-date/i.test(stderr);
    return branch ? { branch, noop, success: true } : { noop, success: true };
  } catch (error: any) {
    const stderr = stderrOf(error, 'git push failed');
    log.debug('[pushGitBranch] failed', { branch, stderr });
    return branch ? { branch, error: stderr, success: false } : { error: stderr, success: false };
  }
};
