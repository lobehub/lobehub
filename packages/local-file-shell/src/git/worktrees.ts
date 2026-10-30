import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isInvalidBranchRef } from './branches';
import { getGitWorkingTreeStatus } from './info';
import type {
  GitAddWorktreeResult,
  GitRemoveWorktreeResult,
  GitResolveWorktreeBaseResult,
  GitWorkingTreeStatus,
  GitWorktreeForkPoint,
  GitWorktreeListItem,
} from './types';
import { getDefaultRemoteBranch } from './upstream';

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

const readGitOutput = async (args: string[], cwd: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

const resolveCommit = (ref: string, cwd: string): Promise<string | undefined> =>
  readGitOutput(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);

/** `origin/HEAD`'s target, else a conventional local default for repos without a remote. */
const resolveDefaultBranch = async (
  dirPath: string,
): Promise<{ name: string; tip: string } | undefined> => {
  const remoteBranch = await getDefaultRemoteBranch(dirPath, 'origin');
  const candidates = remoteBranch
    ? [{ name: remoteBranch.slice('origin/'.length), ref: `refs/remotes/${remoteBranch}` }]
    : ['main', 'master'].map((name) => ({ name, ref: `refs/heads/${name}` }));

  for (const { name, ref } of candidates) {
    const tip = await resolveCommit(ref, dirPath);
    if (tip) return { name, tip };
  }
};

const readForkPoint = async (
  worktree: ParsedWorktree,
  defaultBranch: { name: string; tip: string } | undefined,
  dirPath: string,
): Promise<GitWorktreeForkPoint | undefined> => {
  if (!defaultBranch || !worktree.head || worktree.bare || worktree.prunable) return undefined;
  // A checkout of the default branch itself wasn't forked from anything.
  if (worktree.branch === defaultBranch.name) return undefined;
  const sha = await readGitOutput(['merge-base', worktree.head, defaultBranch.tip], dirPath);
  if (!sha) return undefined;
  return { atTip: sha === defaultBranch.tip, defaultBranch: defaultBranch.name, sha };
};

export const listGitWorktrees = async (dirPath: string): Promise<GitWorktreeListItem[]> => {
  try {
    const [{ stdout: rootStdout }, { stdout }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dirPath, timeout: 5000 }),
      execFileAsync('git', ['worktree', 'list', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      }),
    ]);

    const currentRoot = await safeRealpath(rootStdout.trim());
    const parsed = parseGitWorktreeList(stdout);
    const [statuses, defaultBranch] = await Promise.all([
      Promise.all(parsed.map(readStatus)),
      resolveDefaultBranch(dirPath),
    ]);
    const forkPoints = await Promise.all(
      parsed.map((worktree) => readForkPoint(worktree, defaultBranch, dirPath)),
    );

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
 * Resolve what a new worktree would fork from: `baseRef` when given, otherwise
 * the current HEAD, which may be a feature branch or a detached HEAD rather than
 * the default branch. Backs both the create dialog's preview and creation itself.
 */
export const resolveGitWorktreeBase = async (payload: {
  baseRef?: string;
  path: string;
}): Promise<GitResolveWorktreeBaseResult> => {
  const { path: dirPath } = payload;
  const baseRef = payload.baseRef?.trim();
  if (!dirPath?.trim()) return { error: 'Working directory is required', success: false };
  if (baseRef && isInvalidBranchRef(baseRef))
    return { error: `Invalid base ref: ${baseRef}`, success: false };

  const sha = await resolveCommit(baseRef || 'HEAD', dirPath);
  if (!sha) return { error: `Unknown base ref: ${baseRef || 'HEAD'}`, success: false };

  if (baseRef && baseRef !== 'HEAD')
    return { base: { detached: false, ref: baseRef, sha }, success: true };

  const branch = await readGitOutput(['symbolic-ref', '--short', '--quiet', 'HEAD'], dirPath);
  return { base: { detached: !branch, ref: branch, sha }, success: true };
};

/**
 * Add a linked worktree checked out on a fresh branch, mirroring the branch
 * switcher's "create branch" flow (`git worktree add -b <branch> <path> <base>`).
 * The new branch forks from `baseRef`, defaulting to the repo's current HEAD; the
 * caller supplies the target directory (an absolute sibling path the renderer
 * derives from the source repo). The base goes to git as the resolved SHA, so a
 * remote-tracking base doesn't also become the new branch's upstream. Returns the
 * created path and base on success so the UI can switch into it.
 */
export const addGitWorktree = async (payload: {
  baseRef?: string;
  branch: string;
  path: string;
  worktreePath: string;
}): Promise<GitAddWorktreeResult> => {
  const { path: dirPath, branch, worktreePath } = payload;
  if (!dirPath?.trim()) return { error: 'Working directory is required', success: false };
  if (!branch?.trim()) return { error: 'Branch name is required', success: false };
  if (!worktreePath?.trim()) return { error: 'Worktree path is required', success: false };
  if (isInvalidBranchRef(branch))
    return { error: `Invalid branch name: ${branch}`, success: false };

  const { base, error } = await resolveGitWorktreeBase({ baseRef: payload.baseRef, path: dirPath });
  if (!base) return { error, success: false };

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
