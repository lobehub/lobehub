import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  GitAheadBehind,
  GitBranchInfo,
  GitBranchListItem,
  GitCheckoutResult,
  GitFileDiffStatus,
  GitLinkedPullRequestResult,
  GitPullResult,
  GitPushResult,
  GitWorkingTreeFiles,
  GitWorkingTreePatch,
  GitWorkingTreePatches,
  GitWorkingTreeStatus,
} from '@lobechat/electron-client-ipc';

import { detectRepoType, resolveGitDir } from '@/utils/git';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:GitCtr');

export default class GitController extends ControllerModule {
  static override readonly groupName = 'git';

  @IpcMethod()
  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    return detectRepoType(dirPath);
  }

  /**
   * Read current git branch from `.git/HEAD`. Returns short sha on detached HEAD.
   * Handles both standard `.git` directories and `.git` worktree pointer files.
   */
  @IpcMethod()
  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    try {
      const gitDir = await resolveGitDir(dirPath);
      if (!gitDir) return {};

      const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
      const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      if (refMatch) {
        return { branch: refMatch[1] };
      }
      // Detached HEAD — HEAD file contains the full sha
      if (/^[\da-f]{40}$/i.test(head)) {
        return { branch: head.slice(0, 7), detached: true };
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Query `gh` CLI for an open pull request whose head branch matches `branch`.
   * Returns status = 'gh-missing' when `gh` is not installed / not authenticated,
   * so the UI can render a helpful tooltip instead of an error.
   */
  @IpcMethod()
  async getLinkedPullRequest(payload: {
    branch: string;
    path: string;
  }): Promise<GitLinkedPullRequestResult> {
    const { path: dirPath, branch } = payload;
    if (!branch) {
      return { pullRequest: null, status: 'ok' };
    }

    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'list',
          '--head',
          branch,
          '--state',
          'open',
          '--limit',
          '5',
          '--json',
          'number,url,title,state',
        ],
        { cwd: dirPath, timeout: 8000 },
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as Array<{
        number: number;
        state: string;
        title: string;
        url: string;
      }>;
      if (parsed.length === 0) {
        return { pullRequest: null, status: 'ok' };
      }
      const [primary, ...rest] = parsed;
      return {
        extraCount: rest.length,
        pullRequest: primary,
        status: 'ok',
      };
    } catch (error: any) {
      const code = error?.code;
      const stderr: string = error?.stderr ?? '';
      // `gh` binary not on PATH
      if (code === 'ENOENT') {
        return { pullRequest: null, status: 'gh-missing' };
      }
      // gh reports auth issues via stderr; treat as a soft-fail
      if (/auth\s+login|not\s+logged\s+in|authentication/i.test(stderr)) {
        return { pullRequest: null, status: 'gh-missing' };
      }
      logger.debug('[getLinkedPullRequest] failed', { branch, code, stderr });
      return { pullRequest: null, status: 'error' };
    }
  }

  /**
   * List local git branches ordered by most recent commit.
   * `current` is true for the checked-out branch.
   */
  @IpcMethod()
  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)',
          'refs/heads',
        ],
        { cwd: dirPath, timeout: 5000 },
      );
      return stdout
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          // Line format: "<HEAD-marker>\t<branch>\t<upstream>" where HEAD-marker is '*' or ' '
          const [head, name, upstream] = line.split('\t');
          return {
            current: head === '*',
            name: name ?? '',
            upstream: upstream || undefined,
          };
        })
        .filter((b) => b.name);
    } catch (error: any) {
      logger.warn('[listGitBranches] git command failed', {
        code: error?.code,
        cwd: dirPath,
        message: error?.message,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return [];
    }
  }

  /**
   * Bucket dirty files into added / modified / deleted via `git status --porcelain -z`.
   * Each file is counted once: untracked (`??`) and staged-add (`A`) → added,
   * any `D` in index or working tree → deleted, everything else (`M`/`R`/`C`/`T`/`U`) → modified.
   *
   * Uses `-z` so paths are NUL-terminated (no C-style quoting, no `\n` splitting bugs).
   * Rename/copy entries (`R`/`C`) emit two NUL-separated tokens — dest path then source
   * path — so the source token must be consumed to keep counts correct.
   */
  @IpcMethod()
  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      });
      const tokens = stdout.split('\0');
      let added = 0;
      let modified = 0;
      let deleted = 0;
      let i = 0;
      while (i < tokens.length) {
        const entry = tokens[i];
        i++;
        if (entry.length < 2) continue;
        const x = entry[0];
        const y = entry[1];
        // R/C entries carry an extra source-path token we must consume.
        if (x === 'R' || x === 'C') i++;
        if (x === '?' && y === '?') {
          added++;
        } else if (x === '!' && y === '!') {
          // ignored — skip
        } else if (x === 'D' || y === 'D') {
          deleted++;
        } else if (x === 'A' || y === 'A') {
          added++;
        } else {
          modified++;
        }
      }
      const total = added + modified + deleted;
      return { added, clean: total === 0, deleted, modified, total };
    } catch {
      return { added: 0, clean: true, deleted: 0, modified: 0, total: 0 };
    }
  }

  /**
   * Return dirty file paths bucketed into added / modified / deleted.
   * Same classification as getGitWorkingTreeStatus, but with per-file paths.
   *
   * Uses `git status --porcelain -z` so paths are NUL-terminated and never C-quoted,
   * which avoids misparsing filenames that legitimately contain ` -> `, quote chars,
   * or newlines. For R/C entries the two NUL-separated tokens are `DEST\0SRC`; we
   * report DEST (the current working-tree path) and discard SRC.
   */
  @IpcMethod()
  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    const execFileAsync = promisify(execFile);
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      });
      const tokens = stdout.split('\0');
      let i = 0;
      while (i < tokens.length) {
        const entry = tokens[i];
        i++;
        if (entry.length < 3) continue;
        const x = entry[0];
        const y = entry[1];
        const filePath = entry.slice(3);
        // R/C entries carry an extra source-path token we must consume.
        if (x === 'R' || x === 'C') i++;
        if (!filePath) continue;
        if (x === '?' && y === '?') {
          added.push(filePath);
        } else if (x === '!' && y === '!') {
          // ignored — skip
        } else if (x === 'D' || y === 'D') {
          deleted.push(filePath);
        } else if (x === 'A' || y === 'A') {
          added.push(filePath);
        } else {
          modified.push(filePath);
        }
      }
      return { added, deleted, modified };
    } catch {
      return { added: [], deleted: [], modified: [] };
    }
  }

  /**
   * Pull every dirty file's unified diff in one shot — one IPC call returns
   * the patches the renderer needs to render `<PatchDiff />` per file. We do
   * the per-file `git diff` invocations in parallel inside this method so
   * the renderer doesn't have to fan out N IPC round trips.
   *
   * Tracked changes (modified / deleted / staged-A) come from
   * `git diff HEAD -- <file>`; pure untracked files come from
   * `git diff --no-index /dev/null <file>` (which exits with code 1 when
   * there are differences — that's success, not failure).
   *
   * Per-file patches are capped at 256 KB; oversized or binary entries get an
   * empty `patch` string and a flag the renderer can use for a placeholder.
   */
  @IpcMethod()
  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    const MAX_PATCH_BYTES = 256 * 1024;
    const execFileAsync = promisify(execFile);

    interface Entry {
      filePath: string;
      isUntracked: boolean;
      status: GitFileDiffStatus;
    }

    // Step 1 — classify every dirty path. Mirrors getGitWorkingTreeFiles but
    // also distinguishes untracked (`??`) from staged-add (`A`) so we can pick
    // the right diff command per entry.
    const entries: Entry[] = [];
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      });
      const tokens = stdout.split('\0');
      let i = 0;
      while (i < tokens.length) {
        const entry = tokens[i];
        i++;
        if (entry.length < 3) continue;
        const x = entry[0];
        const y = entry[1];
        const filePath = entry.slice(3);
        // R/C entries carry an extra source-path token we must consume.
        if (x === 'R' || x === 'C') i++;
        if (!filePath) continue;
        if (x === '?' && y === '?') {
          entries.push({ filePath, isUntracked: true, status: 'added' });
        } else if (x === '!' && y === '!') {
          // ignored
        } else if (x === 'D' || y === 'D') {
          entries.push({ filePath, isUntracked: false, status: 'deleted' });
        } else if (x === 'A' || y === 'A') {
          entries.push({ filePath, isUntracked: false, status: 'added' });
        } else {
          entries.push({ filePath, isUntracked: false, status: 'modified' });
        }
      }
    } catch (error: any) {
      logger.warn('[getGitWorkingTreePatches] status failed', {
        cwd: dirPath,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return { patches: [] };
    }

    // Walk the patch line-by-line counting `+`/`-` payload lines while
    // skipping the `+++ b/...` / `--- a/...` headers (they look like
    // additions/deletions but aren't). Cheap enough to do inline per file —
    // each patch is capped at MAX_PATCH_BYTES.
    const countAddDel = (patch: string): { additions: number; deletions: number } => {
      let additions = 0;
      let deletions = 0;
      for (const line of patch.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      }
      return { additions, deletions };
    };

    // Step 2 — per-file diff in parallel. `--no-index` exits 1 when there's a
    // diff (which is the expected outcome for untracked files), so we have to
    // pull stdout off the rejected error rather than letting it throw.
    const patches = await Promise.all(
      entries.map(async ({ filePath, isUntracked, status }): Promise<GitWorkingTreePatch> => {
        const args = isUntracked
          ? ['diff', '--no-color', '--no-index', '/dev/null', filePath]
          : ['diff', '--no-color', 'HEAD', '--', filePath];

        let text: string;
        try {
          const { stdout } = await execFileAsync('git', args, {
            cwd: dirPath,
            encoding: 'utf8',
            maxBuffer: MAX_PATCH_BYTES * 4,
            timeout: 10_000,
          });
          text = stdout as string;
        } catch (error: any) {
          if (error?.stdout == null) {
            logger.debug('[getGitWorkingTreePatches] diff failed', {
              filePath,
              status,
              stderr: error?.stderr?.toString?.() ?? error?.stderr,
            });
            return {
              additions: 0,
              deletions: 0,
              filePath,
              isBinary: false,
              patch: '',
              status,
              truncated: false,
            };
          }
          text = error.stdout.toString();
        }

        if (text.length > MAX_PATCH_BYTES) {
          return {
            additions: 0,
            deletions: 0,
            filePath,
            isBinary: false,
            patch: '',
            status,
            truncated: true,
          };
        }
        if (/^Binary files .* differ$/m.test(text)) {
          return {
            additions: 0,
            deletions: 0,
            filePath,
            isBinary: true,
            patch: '',
            status,
            truncated: false,
          };
        }
        const { additions, deletions } = countAddDel(text);
        return {
          additions,
          deletions,
          filePath,
          isBinary: false,
          patch: text,
          status,
          truncated: false,
        };
      }),
    );

    // Re-bucket so the UI sees added → modified → deleted (matches the
    // working-tree popover order).
    const order: Record<GitFileDiffStatus, number> = { added: 0, modified: 1, deleted: 2 };
    patches.sort((a, b) => order[a.status] - order[b.status]);

    return { patches };
  }

  /**
   * Count commits HEAD is ahead/behind its upstream tracking ref.
   * Returns `hasUpstream: false` when the branch has no upstream configured
   * (e.g. local-only branches, or after the remote branch is deleted).
   *
   * Does a best-effort `git fetch` first so the result reflects what's
   * actually on the remote — the renderer calls this via SWR with
   * `revalidateOnFocus`, so the fetch piggybacks on window re-focus. Fetch
   * failures (offline, no credentials, no `origin` remote) are swallowed so
   * we still return whatever can be computed against the cached refs.
   */
  @IpcMethod()
  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    const execFileAsync = promisify(execFile);
    try {
      await execFileAsync('git', ['fetch', '--no-tags', '--quiet', 'origin'], {
        cwd: dirPath,
        timeout: 10_000,
      });
    } catch {
      // swallow — fall through to compute against cached refs
    }
    try {
      const { stdout: upstreamOut } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        { cwd: dirPath, timeout: 5000 },
      );
      const upstream = upstreamOut.trim();
      if (!upstream) return { ahead: 0, behind: 0, hasUpstream: false };

      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
        { cwd: dirPath, timeout: 5000 },
      );
      const [behindStr, aheadStr] = stdout.trim().split(/\s+/);
      const behind = Number.parseInt(behindStr ?? '0', 10) || 0;
      const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0;

      // `git push -u origin HEAD` always targets origin/<current-branch-name>,
      // which may differ from upstream (the branched-off-canary case).
      let pushTarget: string | undefined;
      let pushTargetExists = false;
      try {
        const { stdout: branchOut } = await execFileAsync(
          'git',
          ['symbolic-ref', '--short', 'HEAD'],
          { cwd: dirPath, timeout: 5000 },
        );
        const branch = branchOut.trim();
        if (branch) {
          pushTarget = `origin/${branch}`;
          try {
            await execFileAsync(
              'git',
              ['rev-parse', '--verify', '--quiet', `refs/remotes/${pushTarget}`],
              { cwd: dirPath, timeout: 5000 },
            );
            pushTargetExists = true;
          } catch {
            pushTargetExists = false;
          }
        }
      } catch {
        // detached HEAD — leave pushTarget undefined
      }

      return { ahead, behind, hasUpstream: true, pushTarget, pushTargetExists, upstream };
    } catch {
      // No upstream configured, detached HEAD, or git error — all treated as "no upstream"
      return { ahead: 0, behind: 0, hasUpstream: false };
    }
  }

  /**
   * Check out (or create + check out) a branch.
   * Relies on git itself to reject unsafe checkouts (dirty tree, non-fast-forward, etc.)
   * and surfaces git's stderr so the UI can display a meaningful error.
   */
  @IpcMethod()
  async checkoutGitBranch(payload: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    const { path: dirPath, branch, create } = payload;
    if (!branch?.trim()) {
      return { error: 'Branch name is required', success: false };
    }
    // Reject obviously invalid refs early to avoid a confusing git error
    if (/[\s~^:?*[\\]/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      return { error: `Invalid branch name: ${branch}`, success: false };
    }

    const execFileAsync = promisify(execFile);
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    try {
      await execFileAsync('git', args, { cwd: dirPath, timeout: 10_000 });
      return { success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[checkoutGitBranch] failed', { args, stderr });
      return { error: stderr || 'git checkout failed', success: false };
    }
  }

  /**
   * Pull the current branch's upstream via fast-forward only.
   *
   * `--ff-only` avoids creating accidental merge commits when the local branch
   * has diverged — in that case the user should resolve merge/rebase in their
   * own terminal. For the common "just behind" case this is a safe one-click.
   */
  @IpcMethod()
  async pullGitBranch(payload: { path: string }): Promise<GitPullResult> {
    const { path: dirPath } = payload;
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('git', ['pull', '--ff-only'], {
        cwd: dirPath,
        timeout: 60_000,
      });
      const noop = /Already up to date/i.test(stdout);
      return { noop, success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[pullGitBranch] failed', { stderr });
      return { error: stderr || 'git pull failed', success: false };
    }
  }

  /**
   * Push the current branch to its same-named remote on `origin`.
   *
   * Uses `git push -u origin HEAD` instead of plain `git push` so the action
   * works even when local branch name differs from the configured upstream
   */
  @IpcMethod()
  async pushGitBranch(payload: { path: string }): Promise<GitPushResult> {
    const { path: dirPath } = payload;
    const execFileAsync = promisify(execFile);
    try {
      const { stderr } = await execFileAsync('git', ['push', '-u', 'origin', 'HEAD'], {
        cwd: dirPath,
        timeout: 60_000,
      });
      // git push writes progress/status to stderr even on success
      const noop = /Everything up-to-date/i.test(stderr);
      return { noop, success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[pushGitBranch] failed', { stderr });
      return { error: stderr || 'git push failed', success: false };
    }
  }
}
