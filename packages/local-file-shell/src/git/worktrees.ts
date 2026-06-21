import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getGitWorkingTreeStatus } from './info';
import type { GitRemoveWorktreeResult, GitWorkingTreeStatus, GitWorktreeListItem } from './types';

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
    const statuses = await Promise.all(parsed.map(readStatus));

    return Promise.all(
      parsed.map(async (worktree, index): Promise<GitWorktreeListItem> => {
        const worktreePath = await safeRealpath(worktree.path);
        return {
          ...worktree,
          current: worktreePath === currentRoot,
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
  if (!worktree.detached)
    return { error: 'Only detached worktrees can be removed', success: false };

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
