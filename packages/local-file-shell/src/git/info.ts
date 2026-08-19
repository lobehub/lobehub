import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import { resolveGitDir } from './repoType';
import type {
  DeviceGitInfo,
  GitAheadBehind,
  GitBranchInfo,
  GitLinkedPullRequest,
  GitLinkedPullRequestResult,
  GitPullRequestCiStatus,
  GitUpstreamRef,
  GitWorkingTreeStatus,
} from './types';
import { getDefaultRemote, resolveUpstream } from './upstream';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

type GithubStatusCheckRollupNode = {
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
};

type GithubPullRequestPayload = {
  baseRefName?: string | null;
  /** The PR's head branch ON GitHub — the authoritative remote ref for this branch. */
  headRefName?: string | null;
  headRepository?: { nameWithOwner?: string | null } | null;
  headRepositoryOwner?: { login?: string | null } | null;
  isDraft?: boolean;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  mergedAt?: string | null;
  number: number;
  reviewDecision?: string | null;
  state: string;
  statusCheckRollup?: GithubStatusCheckRollupNode[] | null;
  title: string;
  url: string;
  updatedAt?: string | null;
};

const GITHUB_PULL_REQUEST_FIELDS =
  'number,url,title,state,isDraft,mergeable,mergeStateStatus,mergedAt,reviewDecision,statusCheckRollup,headRefName,headRepository,headRepositoryOwner,baseRefName,updatedAt';

const failureConclusions = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'timed_out',
]);
const pendingStates = new Set([
  'expected',
  'in_progress',
  'pending',
  'queued',
  'requested',
  'waiting',
]);
const successConclusions = new Set(['neutral', 'skipped', 'success']);

const toLowerStatus = (value?: string | null) => value?.toLowerCase();

const resolveCiStatus = (
  checks?: GithubStatusCheckRollupNode[] | null,
): GitPullRequestCiStatus | undefined => {
  if (!Array.isArray(checks)) return undefined;
  if (checks.length === 0) return undefined;

  let hasPending = false;
  let hasUnknown = false;

  for (const check of checks) {
    const conclusion = toLowerStatus(check.conclusion);
    const state = toLowerStatus(check.state) ?? toLowerStatus(check.status);

    if (
      (conclusion && failureConclusions.has(conclusion)) ||
      state === 'failure' ||
      state === 'error'
    ) {
      return 'failure';
    }

    if (state && pendingStates.has(state)) {
      hasPending = true;
      continue;
    }

    if ((conclusion && successConclusions.has(conclusion)) || state === 'success') {
      continue;
    }

    hasUnknown = true;
  }

  if (hasPending) return 'pending';
  return hasUnknown ? 'unknown' : 'success';
};

const compactString = (value?: string | null) => value || undefined;

const normalizeGithubPullRequest = (pr: GithubPullRequestPayload): GitLinkedPullRequest => {
  const ciStatus = resolveCiStatus(pr.statusCheckRollup);
  const mergeable = compactString(pr.mergeable);
  const mergeStateStatus = compactString(pr.mergeStateStatus);
  const reviewDecision = compactString(pr.reviewDecision);

  return {
    ...(compactString(pr.baseRefName) ? { baseRefName: pr.baseRefName! } : {}),
    ...(ciStatus ? { ciStatus } : {}),
    ...(pr.isDraft === undefined ? {} : { isDraft: pr.isDraft }),
    ...(mergeable ? { mergeable } : {}),
    ...(mergeStateStatus ? { mergeStateStatus } : {}),
    ...(pr.mergedAt === undefined ? {} : { mergedAt: pr.mergedAt }),
    number: pr.number,
    ...(reviewDecision ? { reviewDecision } : {}),
    state: pr.state,
    title: pr.title,
    url: pr.url,
  };
};

/**
 * Current branch short name, or short SHA + `detached` for detached HEAD, plus the
 * remote ref the branch publishes to.
 *
 * The branch itself stays a pure `.git/HEAD` read — this is the cheap leg, split
 * from the `gh` lookup so the branch label can revalidate on every working-directory
 * switch. Upstream resolution adds local git reads (never network, never `gh`) and
 * only for an attached HEAD, so a detached checkout costs exactly what it did before.
 */
export const getGitBranch = async (dirPath: string): Promise<GitBranchInfo> => {
  try {
    const gitDir = await resolveGitDir(dirPath);
    if (!gitDir) return {};

    const head = (await readFile(`${gitDir}/HEAD`, 'utf8')).trim();
    const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (refMatch) {
      const branch = refMatch[1];
      const { upstream } = await resolveUpstream(dirPath, branch);
      return { branch, ...(upstream ? { upstream } : {}) };
    }
    // Detached HEAD — HEAD file contains the full sha
    if (/^[\da-f]{40}$/i.test(head)) return { branch: head.slice(0, 7), detached: true };
    return {};
  } catch {
    return {};
  }
};

const parseGithubRepository = (remoteUrl: string): string | undefined => {
  const value = remoteUrl.trim();
  const parsePath = (pathname: string) => {
    const match = /^\/?([^/]+)\/([^/]+?)(?:\.git)?$/.exec(pathname);
    return match ? `${match[1]}/${match[2]}` : undefined;
  };

  if (value.includes('://')) {
    try {
      const url = new URL(value);
      return url.hostname.toLowerCase() === 'github.com' ? parsePath(url.pathname) : undefined;
    } catch {
      return undefined;
    }
  }

  const scpLike = /^(?:[^@]+@)?github\.com:(.+)$/i.exec(value);
  return scpLike ? parsePath(scpLike[1]) : undefined;
};

const getPublishedRepository = async (
  dirPath: string,
  upstream: GitUpstreamRef,
): Promise<string | undefined> => {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', '--push', upstream.remote], {
    cwd: dirPath,
    timeout: 5000,
  });
  return parseGithubRepository(stdout);
};

const matchesPublishedHead = (pr: GithubPullRequestPayload, repository: string, branch: string) =>
  pr.headRefName === branch &&
  pr.headRepository?.nameWithOwner?.toLowerCase() === repository.toLowerCase();

/** Name the remote of a ref GitHub reported, where only the branch crosses the wire. */
const toUpstreamRef = async (
  dirPath: string,
  branch: string | undefined | null,
  fallback?: GitUpstreamRef,
): Promise<GitUpstreamRef | undefined> => {
  if (!branch) return fallback;
  if (fallback?.branch === branch) return fallback;

  const remote = fallback?.remote ?? (await getDefaultRemote(dirPath));
  return remote ? { branch, remote } : fallback;
};

/**
 * Resolve the PRs linked to the branch's proven GitHub publication target:
 *
 * 1. a saved PR number → direct `gh pr view` using the established topic behavior;
 * 2. otherwise resolve the remote repository + branch that the local branch publishes to;
 * 3. discover every Open PR with the exact head repository + branch in the
 *    published repository and, for fork workflows, its parent repository.
 *
 * Live discovery never uses the local branch name as a remote identity and never
 * revives historical Closed/Merged PRs. Without a proven publication target, this
 * deliberately returns no PR rather than guessing from a branch name or commit.
 *
 * Returns `status: 'gh-missing'` when `gh` is unavailable / not authed.
 */
export const getLinkedPullRequest = async (payload: {
  branch: string;
  path: string;
  pullRequestNumber?: number;
}): Promise<GitLinkedPullRequestResult> => {
  const { path: dirPath, branch, pullRequestNumber } = payload;
  if (!branch && pullRequestNumber === undefined) return { pullRequest: null, status: 'ok' };

  const viewPullRequest = async (number: number) => {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(number), '--json', GITHUB_PULL_REQUEST_FIELDS],
      { cwd: dirPath, timeout: 8000 },
    );
    return JSON.parse(stdout.trim() || '{}') as GithubPullRequestPayload;
  };

  try {
    // Resolved for the NAMED branch rather than HEAD, so a caller holding a topic's
    // persisted branch gets that branch's remote ref even if the directory moved on.
    const { upstream: localUpstream } = branch
      ? await resolveUpstream(dirPath, branch)
      : { upstream: undefined };

    if (pullRequestNumber !== undefined) {
      const parsed = await viewPullRequest(pullRequestNumber);
      const upstream = await toUpstreamRef(dirPath, parsed.headRefName, localUpstream);
      return {
        pullRequest: normalizeGithubPullRequest(parsed),
        status: 'ok',
        ...(upstream ? { upstream } : {}),
      };
    }

    // A local branch with no proven publication target cannot own a remote PR.
    if (!localUpstream) return { pullRequest: null, status: 'ok' };
    const publishedRepository = await getPublishedRepository(dirPath, localUpstream);
    if (!publishedRepository) return { pullRequest: null, status: 'ok', upstream: localUpstream };

    const { stdout: repoJson } = await execFileAsync(
      'gh',
      ['api', `repos/${publishedRepository}`],
      {
        cwd: dirPath,
        timeout: 8000,
      },
    );
    const parent = (JSON.parse(repoJson) as { parent?: { full_name?: string } }).parent?.full_name;
    const repositories = [...new Set([publishedRepository, parent].filter(Boolean))] as string[];

    const results = await Promise.all(
      repositories.map(async (repository) => {
        const { stdout } = await execFileAsync(
          'gh',
          [
            'pr',
            'list',
            '--repo',
            repository,
            '--head',
            localUpstream.branch,
            '--state',
            'open',
            '--limit',
            '1000',
            '--json',
            GITHUB_PULL_REQUEST_FIELDS,
          ],
          { cwd: dirPath, timeout: 8000 },
        );
        return JSON.parse(stdout.trim() || '[]') as GithubPullRequestPayload[];
      }),
    );
    const parsed = results
      .flat()
      .filter(
        (pr) =>
          pr.state.toUpperCase() === 'OPEN' &&
          matchesPublishedHead(pr, publishedRepository, localUpstream.branch),
      )
      .filter((pr, index, all) => all.findIndex((item) => item.url === pr.url) === index)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

    if (parsed.length > 0) {
      const pullRequests = parsed.map(normalizeGithubPullRequest);
      return {
        extraCount: pullRequests.length - 1,
        pullRequest: pullRequests[0],
        pullRequests,
        status: 'ok',
        upstream: localUpstream,
      };
    }

    return {
      pullRequest: null,
      status: 'ok',
      upstream: localUpstream,
    };
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
  const { branch, detached, upstream } = await getGitBranch(dirPath);

  let info: DeviceGitInfo['info'] = { branch, detached, upstream };
  if (branch && !detached && params.isGithub) {
    const pr = await getLinkedPullRequest({ branch, path: dirPath });
    info = {
      branch,
      detached,
      extraCount: pr.extraCount,
      ghMissing: pr.status === 'gh-missing',
      pullRequest: pr.pullRequest,
      // The PR's own head ref outranks the locally-inferred one, and is the only
      // ref available at all when the push left no local trace.
      upstream: pr.upstream ?? upstream,
    };
  }

  const [workingStatus, aheadBehind] = await Promise.all([
    getGitWorkingTreeStatus(dirPath),
    getGitAheadBehind(dirPath),
  ]);

  return { aheadBehind, info, workingStatus };
};
