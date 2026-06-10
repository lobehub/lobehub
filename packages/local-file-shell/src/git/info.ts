import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import { resolveGitDir } from './repoType';
import type {
  DeviceGitInfo,
  GitAheadBehind,
  GitBranchInfo,
  GitLinkedPullRequestResult,
  GitWorkingTreeStatus,
} from './types';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

/** Current branch short name, or short SHA + `detached` for detached HEAD. */
export const getGitBranch = async (dirPath: string): Promise<GitBranchInfo> => {
  try {
    const gitDir = await resolveGitDir(dirPath);
    if (!gitDir) return {};

    const head = (await readFile(`${gitDir}/HEAD`, 'utf8')).trim();
    const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (refMatch) return { branch: refMatch[1] };
    // Detached HEAD — HEAD file contains the full sha
    if (/^[\da-f]{40}$/i.test(head)) return { branch: head.slice(0, 7), detached: true };
    return {};
  } catch {
    return {};
  }
};

/**
 * Query `gh` CLI for an open pull request whose head branch matches `branch`.
 * Returns `status: 'gh-missing'` when `gh` is unavailable / not authed.
 */
export const getLinkedPullRequest = async (payload: {
  branch: string;
  path: string;
}): Promise<GitLinkedPullRequestResult> => {
  const { path: dirPath, branch } = payload;
  if (!branch) return { pullRequest: null, status: 'ok' };

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
    if (parsed.length === 0) return { pullRequest: null, status: 'ok' };
    const [primary, ...rest] = parsed;
    return { extraCount: rest.length, pullRequest: primary, status: 'ok' };
  } catch (error: any) {
    const code = error?.code;
    const stderr: string = error?.stderr ?? '';
    if (code === 'ENOENT') return { pullRequest: null, status: 'gh-missing' };
    if (/auth\s+login|not\s+logged\s+in|authentication/i.test(stderr)) {
      return { pullRequest: null, status: 'gh-missing' };
    }
    log.debug('[getLinkedPullRequest] failed', { branch, code, stderr });
    return { pullRequest: null, status: 'error' };
  }
};

/** Bucket dirty files into added / modified / deleted via `git status --porcelain -z`. */
export const getGitWorkingTreeStatus = async (dirPath: string): Promise<GitWorkingTreeStatus> => {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u', '-z'], {
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
};

/**
 * Count commits HEAD is ahead/behind its upstream. Does a best-effort `git fetch`
 * first; swallows fetch failures (offline / no creds) and computes against cached
 * refs. Returns `hasUpstream: false` when no upstream is configured.
 */
export const getGitAheadBehind = async (dirPath: string): Promise<GitAheadBehind> => {
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
    return { ahead: 0, behind: 0, hasUpstream: false };
  }
};

/**
 * Aggregate git status (branch + linked PR + working tree + ahead/behind) into one
 * payload. The single source behind the desktop display, the device `gitInfo` RPC,
 * and the CLI. PR lookup runs only for a real branch on a GitHub remote.
 */
export const gitInfo = async (params: {
  isGithub?: boolean;
  scope: string;
}): Promise<DeviceGitInfo> => {
  const dirPath = params.scope;
  const { branch, detached } = await getGitBranch(dirPath);

  let info: DeviceGitInfo['info'] = { branch, detached };
  if (branch && !detached && params.isGithub) {
    const pr = await getLinkedPullRequest({ branch, path: dirPath });
    info = {
      branch,
      detached,
      extraCount: pr.extraCount,
      ghMissing: pr.status === 'gh-missing',
      pullRequest: pr.pullRequest,
    };
  }

  const [workingStatus, aheadBehind] = await Promise.all([
    getGitWorkingTreeStatus(dirPath),
    getGitAheadBehind(dirPath),
  ]);

  return { aheadBehind, info, workingStatus };
};
