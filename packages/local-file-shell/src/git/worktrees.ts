import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isInvalidBranchRef } from './branches';
import { getGitWorkingTreeStatus } from './info';
import type {
  GitAddWorktreeResult,
  GitRemoveWorktreeResult,
  GitWorkingTreeStatus,
  GitWorktreeBase,
  GitWorktreeForkPoint,
  GitWorktreeListItem,
} from './types';

const execFileAsync = promisify(execFile);

const normalizeBranchRef = (ref: string): string =>
  ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

const safeRealpath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
};

interface ParsedWorktree {
  bare?: boolean;
  branch?: string;
  detached?: boolean;
  head?: string;
  locked?: boolean;
  lockReason?: string;
  path: string;
  prunable?: boolean;
  pruneReason?: string;
}

export const parseGitWorktreeList = (stdout: string): ParsedWorktree[] => {
  const records: ParsedWorktree[] = [];
  let current: ParsedWorktree | undefined;

  for (const token of stdout.split('\0')) {
    if (!token) {
      if (current) {
        records.push(current);
        current = undefined;
      }
      continue;
    }

    const [key, ...rest] = token.split(' ');
    const value = rest.join(' ');

    if (key === 'worktree') {
      if (current) records.push(current);
      current = { path: value };
      continue;
    }

    if (!current) continue;

    switch (key) {
      case 'HEAD': {
        current.head = value;
        break;
      }
      case 'bare': {
        current.bare = true;
        break;
      }
      case 'branch': {
        current.branch = normalizeBranchRef(value);
        break;
      }
      case 'detached': {
        current.detached = true;
        break;
      }
      case 'locked': {
        current.locked = true;
        current.lockReason = value || undefined;
        break;
      }
      case 'prunable': {
        current.prunable = true;
        current.pruneReason = value || undefined;
        break;
      }
    }
  }

  if (current) records.push(current);
  return records;
};

const readStatus = async (worktree: ParsedWorktree): Promise<GitWorkingTreeStatus | undefined> => {
  if (worktree.bare || worktree.prunable) return undefined;
  return getGitWorkingTreeStatus(worktree.path);
};

const runGit = async (dirPath: string, args: string[]): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: dirPath, timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

const resolveCommit = (dirPath: string, ref: string): Promise<string | undefined> =>
  runGit(dirPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

interface DefaultBranch {
  /** Ref the fork point is computed against. */
  ref: string;
  sha: string;
}

/**
 * The repo's default branch: the remote default (`origin/HEAD`), else a local
 * `main` / `master`. A repo that was `git init`-ed and never cloned has no
 * `origin/HEAD`, so the local fallbacks keep fork points visible there too.
 */
const resolveDefaultBranch = async (dirPath: string): Promise<DefaultBranch | undefined> => {
  const remoteDefault = await runGit(dirPath, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  const candidates = remoteDefault ? [remoteDefault] : ['main', 'master'];

  for (const ref of candidates) {
    const sha = await resolveCommit(dirPath, ref);
    if (sha) return { ref, sha };
  }
};

const readForkPoint = async (
  dirPath: string,
  worktree: ParsedWorktree,
  defaultBranch: DefaultBranch | undefined,
): Promise<GitWorktreeForkPoint | undefined> => {
  // Every checkout gets one, the default branch's own included: a local `canary`
  // behind `origin/canary` then reads as forked off an older tip, which it is.
  if (!defaultBranch || !worktree.head || worktree.bare || worktree.prunable) return undefined;

  const sha = await runGit(dirPath, ['merge-base', worktree.head, defaultBranch.sha]);
  if (!sha) return undefined;

  return { atTip: sha === defaultBranch.sha, baseBranch: defaultBranch.ref, sha };
};

export const listGitWorktrees = async (dirPath: string): Promise<GitWorktreeListItem[]> => {
  try {
    const [{ stdout: rootStdout }, { stdout }, defaultBranch] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dirPath, timeout: 5000 }),
      execFileAsync('git', ['worktree', 'list', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      }),
      resolveDefaultBranch(dirPath),
    ]);

    const currentRoot = await safeRealpath(rootStdout.trim());
    const parsed = parseGitWorktreeList(stdout);
    const [statuses, forkPoints] = await Promise.all([
      Promise.all(parsed.map(readStatus)),
      Promise.all(parsed.map((worktree) => readForkPoint(dirPath, worktree, defaultBranch))),
    ]);

    return Promise.all(
      parsed.map(async (worktree, index): Promise<GitWorktreeListItem> => {
        const worktreePath = await safeRealpath(worktree.path);
        return {
          ...worktree,
          current: worktreePath === currentRoot,
          forkPoint: forkPoints[index],
          path: worktree.path,
          status: statuses[index],
        };
      }),
    );
  } catch {
    return [];
  }
};

const findListedWorktree = async (
  dirPath: string,
  worktreePath: string,
): Promise<GitWorktreeListItem | undefined> => {
  const targetPath = await safeRealpath(worktreePath);
  const worktrees = await listGitWorktrees(dirPath);

  for (const worktree of worktrees) {
    if ((await safeRealpath(worktree.path)) === targetPath) return worktree;
  }
};

export const removeGitWorktree = async (payload: {
  path: string;
  worktreePath: string;
}): Promise<GitRemoveWorktreeResult> => {
  const { path: dirPath, worktreePath } = payload;
  if (!dirPath?.trim()) return { error: 'Working directory is required', success: false };
  if (!worktreePath?.trim()) return { error: 'Worktree path is required', success: false };

  const worktree = await findListedWorktree(dirPath, worktreePath);
  if (!worktree) return { error: 'Worktree not found', success: false };
  if (worktree.current) return { error: 'Cannot remove the current worktree', success: false };
  if (worktree.bare) return { error: 'Cannot remove the bare worktree', success: false };

  try {
    await execFileAsync('git', ['worktree', 'remove', worktree.path], {
      cwd: dirPath,
      timeout: 30_000,
    });
    return { success: true };
  } catch (error: any) {
    const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
    return { error: stderr || 'git worktree remove failed', success: false };
  }
};

/**
 * Resolve what a new worktree branch forks from. Without `baseRef` that is the
 * repo's current HEAD — named by its branch, or flagged `detached` so the UI can
 * say "based on <sha> (detached HEAD)" instead of succeeding silently.
 */
const resolveWorktreeBase = async (
  dirPath: string,
  baseRef: string | undefined,
): Promise<GitWorktreeBase | undefined> => {
  if (baseRef) {
    // The picker offers branch names, so read a name as a branch first: bare,
    // git ranks a same-named tag above both `refs/heads/` and `refs/remotes/`.
    for (const qualified of [`refs/heads/${baseRef}`, `refs/remotes/${baseRef}`]) {
      const sha = await resolveCommit(dirPath, qualified);
      if (sha) return { ref: baseRef, sha };
    }

    const sha = await resolveCommit(dirPath, baseRef);
    if (!sha) return undefined;
    // A SHA (or a prefix of one) names nothing beyond the commit itself.
    const isSha = /^[\da-f]{4,40}$/i.test(baseRef) && sha.startsWith(baseRef.toLowerCase());
    return isSha ? { sha } : { ref: baseRef, sha };
  }

  const sha = await resolveCommit(dirPath, 'HEAD');
  if (!sha) return undefined;

  const branch = await runGit(dirPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return branch ? { ref: branch, sha } : { detached: true, sha };
};

/**
 * Add a linked worktree checked out on a fresh branch, mirroring the branch
 * switcher's "create branch" flow (`git worktree add -b <branch> <path> <base>`).
 * The new branch forks from `baseRef` when given, else from the repo's current
 * HEAD; either way the base is resolved to a SHA up front and passed explicitly,
 * so what was resolved is exactly what gets checked out, and a remote-tracking
 * base never becomes the new branch's upstream. The caller supplies the target
 * directory (an absolute sibling path the renderer derives from the source repo).
 * Returns the created path and the resolved base so the UI can switch into it
 * and say what it forked from.
 */
export const addGitWorktree = async (payload: {
  baseRef?: string;
  branch: string;
  path: string;
  worktreePath: string;
}): Promise<GitAddWorktreeResult> => {
  const { path: dirPath, branch, worktreePath } = payload;
  const baseRef = payload.baseRef?.trim() || undefined;
  if (!dirPath?.trim()) return { error: 'Working directory is required', success: false };
  if (!branch?.trim()) return { error: 'Branch name is required', success: false };
  if (!worktreePath?.trim()) return { error: 'Worktree path is required', success: false };
  if (isInvalidBranchRef(branch))
    return { error: `Invalid branch name: ${branch}`, success: false };
  if (baseRef && isInvalidBranchRef(baseRef))
    return { error: `Invalid base ref: ${baseRef}`, success: false };

  const base = await resolveWorktreeBase(dirPath, baseRef);
  if (!base)
    return {
      error: baseRef ? `Unknown base ref: ${baseRef}` : 'Cannot resolve the current HEAD',
      success: false,
    };

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, base.sha], {
      cwd: dirPath,
      timeout: 30_000,
    });
    return { base, success: true, worktreePath };
  } catch (error: any) {
    const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
    return { error: stderr || 'git worktree add failed', success: false };
  }
};
