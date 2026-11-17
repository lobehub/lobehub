import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import { isInvalidBranchRef } from './branches';
import type { GitOwnedWorktreeCleanupResult, GitOwnedWorktreeRestoreResult } from './types';
import { parseGitWorktreeList } from './worktrees';

const log = createLogger('local-file-shell:git:owned-worktree');
const warn = (message: string, ...args: unknown[]) => log.warn(message, ...args);
const execFileAsync = promisify(execFile);

/**
 * Cleanup and restore of the worktrees the app created for a conversation
 * (`~/.lobehub/worktrees/<repoKey>/<branch>`). Everything that decides whether
 * a folder may be deleted runs here, on the device that holds it: the server
 * only names a path, and a path is acted on only when every guard agrees it is
 * a linked worktree of that source repo inside the app's worktree root.
 */

/** Whole-operation budget; a slow `git worktree remove` falls back before it. */
const CLEANUP_TIMEOUT_MS = 90_000;
const GIT_REMOVE_TIMEOUT_MS = 45_000;
const GIT_TIMEOUT_MS = 15_000;
/** Node's `rm` retries EBUSY / ENOTEMPTY / EPERM (Windows file locks, a watcher). */
const RM_RETRY = { maxRetries: 5, retryDelay: 200 } as const;

export const defaultOwnedWorktreeRoot = () => path.join(homedir(), '.lobehub', 'worktrees');

const git = async (cwd: string, args: string[], timeout = GIT_TIMEOUT_MS) =>
  (await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout })).stdout;

const gitError = (error: any, fallback: string): string =>
  (error?.stderr ?? error?.message ?? '').toString().trim() || fallback;

const safeRealpath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
};

/** `child` is strictly below `parent` (both already resolved). */
const isStrictlyInside = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

class GuardError extends Error {}

/**
 * The lexical half of the path guard, which also holds for a folder that no
 * longer exists: absolute, and below the root once `..` is resolved.
 */
const assertLexicallyInsideRoot = (root: string, worktreePath: string) => {
  if (!path.isAbsolute(worktreePath))
    throw new GuardError(`Worktree path must be absolute: ${worktreePath}`);
  if (!isStrictlyInside(path.resolve(root), path.resolve(worktreePath)))
    throw new GuardError(`Not inside the app's worktree folder: ${worktreePath}`);
};

/**
 * The on-disk half: with symlinks resolved the folder is still below the root
 * (a symlinked worktree or root cannot point the delete elsewhere), and it is
 * a real directory, not a link to one.
 */
const assertResolvedInsideRoot = async (root: string, worktreePath: string) => {
  const stat = await lstat(worktreePath);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new GuardError(`Not a worktree folder: ${worktreePath}`);
  const [realRoot, realTarget] = await Promise.all([
    safeRealpath(root),
    safeRealpath(worktreePath),
  ]);
  if (!isStrictlyInside(realRoot, realTarget))
    throw new GuardError(`Resolves outside the app's worktree folder: ${worktreePath}`);
};

interface ListedWorktree {
  branch?: string;
  locked?: boolean;
  path: string;
}

/**
 * The source repo's own view: the worktree must be one of its linked
 * worktrees (registered, not the main checkout, not bare).
 */
const findLinkedWorktree = async (
  sourcePath: string,
  worktreePath: string,
): Promise<ListedWorktree | undefined> => {
  const stdout = await git(sourcePath, ['worktree', 'list', '--porcelain', '-z']);
  const [main, ...linked] = parseGitWorktreeList(stdout);
  const target = await safeRealpath(worktreePath);
  if (main && (await safeRealpath(main.path)) === target)
    throw new GuardError('Refusing to remove the main worktree');
  for (const entry of linked) {
    if (entry.bare) continue;
    if ((await safeRealpath(entry.path)) === target) return entry;
  }
};

/** The repo's shared git dir (`<source>/.git` for a normal checkout). */
const commonGitDir = async (sourcePath: string): Promise<string> => {
  const out = (await git(sourcePath, ['rev-parse', '--git-common-dir'])).trim();
  return safeRealpath(path.resolve(sourcePath, out));
};

/**
 * A linked worktree's `.git` is a FILE pointing at
 * `<common git dir>/worktrees/<name>`; anything else (a full clone, a pointer
 * into another repository) is not this repo's worktree.
 */
const assertGitFilePointsToSource = async (sourcePath: string, worktreePath: string) => {
  const dotGit = path.join(worktreePath, '.git');
  const stat = await lstat(dotGit).catch(() => undefined);
  if (!stat?.isFile()) throw new GuardError('Worktree has no .git file');
  const match = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'));
  if (!match) throw new GuardError('Worktree .git file has no gitdir');
  const gitdir = await safeRealpath(path.resolve(worktreePath, match[1].trim()));
  const worktreesDir = path.join(await commonGitDir(sourcePath), 'worktrees');
  if (!isStrictlyInside(worktreesDir, gitdir))
    throw new GuardError('Worktree .git does not point back to the source repository');
};

/**
 * Uncommitted work that would be lost: tracked changes (staged or not) and
 * untracked files. Ignored files (`node_modules`, build output) do not count,
 * and neither do unpushed commits — the branch is always kept.
 */
export const countUncommittedFiles = async (worktreePath: string): Promise<number> => {
  const stdout = await git(worktreePath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=dirty',
  ]);
  const tokens = stdout.split('\0');
  let count = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    count += 1;
    // A rename / copy record carries its original path as the next token.
    if (token[0] === 'R' || token[0] === 'C') i += 1;
  }
  return count;
};

const prune = async (sourcePath: string) => {
  await git(sourcePath, ['worktree', 'prune']).catch((error) =>
    warn('git worktree prune failed in %s: %O', sourcePath, error),
  );
};

/**
 * Remove the folder after `git worktree remove` gave up (a file lock, a huge
 * `node_modules` hitting the timeout). Moving it into the root's `.trash`
 * first is one rename, so the worktree is gone at once; the slow delete then
 * runs in the background. If even the rename fails the folder is deleted in
 * place, retrying the transient errors.
 */
const forceRemoveFolder = async (root: string, worktreePath: string) => {
  const trashDir = path.join(root, '.trash');
  const parked = path.join(trashDir, `${path.basename(worktreePath)}-${Date.now()}`);
  try {
    await mkdir(trashDir, { recursive: true });
    await rename(worktreePath, parked);
  } catch (error) {
    warn('could not park %s, deleting in place: %O', worktreePath, error);
    await rm(worktreePath, { force: true, recursive: true, ...RM_RETRY });
    return;
  }
  void rm(parked, { force: true, recursive: true, ...RM_RETRY }).catch((error) =>
    warn('background delete of %s failed: %O', parked, error),
  );
};

const withTimeout = async <T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export interface CleanupOwnedWorktreeParams {
  /** Delete even with uncommitted work: the user confirmed "Discard and delete". */
  discard?: boolean;
  /** The worktree root; tests only. Device RPCs never pass it. */
  rootDir?: string;
  sourcePath: string;
  worktreePath: string;
}

const runCleanup = async ({
  discard,
  rootDir,
  sourcePath,
  worktreePath,
}: CleanupOwnedWorktreeParams): Promise<GitOwnedWorktreeCleanupResult> => {
  const root = rootDir ?? defaultOwnedWorktreeRoot();
  if (!sourcePath?.trim() || !worktreePath?.trim())
    return { error: 'Source and worktree paths are required', outcome: 'refused' };

  try {
    assertLexicallyInsideRoot(root, worktreePath);

    // Gone already (deleted by hand, or a cleanup that finished after its
    // report was lost): only the stale registration is left to drop.
    if (!existsSync(worktreePath)) {
      if (existsSync(sourcePath)) await prune(sourcePath);
      return { outcome: 'removed' };
    }

    await assertResolvedInsideRoot(root, worktreePath);
    const listed = await findLinkedWorktree(sourcePath, worktreePath);
    if (!listed) throw new GuardError('Not a worktree of the source repository');
    await assertGitFilePointsToSource(sourcePath, worktreePath);

    const branch = listed.branch;
    if (listed.locked) return { branch, outcome: 'locked' };

    if (!discard) {
      const dirtyFiles = await countUncommittedFiles(worktreePath);
      if (dirtyFiles > 0) return { branch, dirtyFiles, outcome: 'dirty' };
    }

    try {
      // `--force`: ignored files alone make a plain remove refuse. One `--force`
      // never removes a locked worktree, which was ruled out above anyway.
      await git(sourcePath, ['worktree', 'remove', '--force', listed.path], GIT_REMOVE_TIMEOUT_MS);
    } catch (error) {
      warn('git worktree remove failed for %s, removing the folder: %O', worktreePath, error);
      await forceRemoveFolder(root, worktreePath);
    }
    await prune(sourcePath);

    if (existsSync(worktreePath))
      return { branch, error: 'The worktree folder could not be removed', outcome: 'error' };
    return { branch, outcome: 'removed' };
  } catch (error) {
    if (error instanceof GuardError) return { error: error.message, outcome: 'refused' };
    return { error: gitError(error, 'Worktree cleanup failed'), outcome: 'error' };
  }
};

/**
 * Remove an app-created worktree's folder when it holds no uncommitted work
 * (or `discard` says to drop it). The branch is never touched. Returns what
 * happened instead of throwing, so the caller can record it as is.
 */
export const cleanupOwnedWorktree = (
  params: CleanupOwnedWorktreeParams,
): Promise<GitOwnedWorktreeCleanupResult> =>
  withTimeout(runCleanup(params), CLEANUP_TIMEOUT_MS, () => ({
    error: 'Worktree cleanup timed out',
    outcome: 'error',
  }));

export interface RestoreOwnedWorktreeParams {
  branch: string;
  /** The worktree root; tests only. Device RPCs never pass it. */
  rootDir?: string;
  sourcePath: string;
  worktreePath: string;
}

/**
 * Check a cleaned-up worktree out again at its original path, on its original
 * branch (`git worktree add <path> <branch>`), for a conversation brought back
 * from the archive or the recycle bin. A worktree already there on that branch
 * counts as restored.
 */
export const restoreOwnedWorktree = async ({
  branch,
  rootDir,
  sourcePath,
  worktreePath,
}: RestoreOwnedWorktreeParams): Promise<GitOwnedWorktreeRestoreResult> => {
  const root = rootDir ?? defaultOwnedWorktreeRoot();
  if (!sourcePath?.trim() || !worktreePath?.trim() || !branch?.trim())
    return { error: 'Source path, worktree path and branch are required', outcome: 'refused' };
  if (isInvalidBranchRef(branch)) return { error: `Invalid branch: ${branch}`, outcome: 'refused' };

  try {
    assertLexicallyInsideRoot(root, worktreePath);

    if (existsSync(worktreePath)) {
      await assertResolvedInsideRoot(root, worktreePath);
      const listed = await findLinkedWorktree(sourcePath, worktreePath);
      if (listed?.branch === branch) return { outcome: 'restored' };
      return { error: `Folder already exists: ${worktreePath}`, outcome: 'refused' };
    }

    const exists = await git(sourcePath, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (!exists) return { outcome: 'branchMissing' };

    // A registration left behind for this path would make `add` refuse.
    await prune(sourcePath);
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await git(sourcePath, ['worktree', 'add', worktreePath, branch], 30_000);
    return { outcome: 'restored' };
  } catch (error) {
    if (error instanceof GuardError) return { error: error.message, outcome: 'refused' };
    return { error: gitError(error, 'git worktree add failed'), outcome: 'error' };
  }
};
