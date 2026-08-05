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
import { getDefaultRemote, isCommitSafeForPullRequestLookup, resolveUpstream } from './upstream';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

type GithubStatusCheckRollupNode = {
  conclusion?: string | null;
  state?: string | null;
  status?: string | null;
};

type GithubPullRequestPayload = {
  /** The PR's head branch ON GitHub — the authoritative remote ref for this branch. */
  headRefName?: string | null;
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
};

const GITHUB_PULL_REQUEST_FIELDS =
  'number,url,title,state,isDraft,mergeable,mergeStateStatus,mergedAt,reviewDecision,statusCheckRollup,headRefName';

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

/**
 * Ask GitHub which PR carries this exact commit. The last resort of the lookup
 * chain: it needs no local trace of the push at all, so it is what recovers a PR
 * on a fresh clone or a second device — and, with it, the remote branch name the
 * commit was pushed under.
 *
 * `{owner}/{repo}` is substituted by `gh` from the working directory's remote.
 * Returns only the PR number + head ref; the caller re-reads the PR through the
 * normal `gh pr view` path so every result shares one shape.
 */
const findPullRequestByCommit = async (
  dirPath: string,
  sha: string,
): Promise<{ headRefName?: string; number: number } | undefined> => {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/{owner}/{repo}/commits/${sha}/pulls`],
      { cwd: dirPath, timeout: 8000 },
    );
    const parsed = JSON.parse(stdout.trim() || '[]') as {
      head?: { ref?: string };
      number?: number;
    }[];
    const [primary] = parsed;
    if (!primary?.number) return undefined;

    return { headRefName: primary.head?.ref, number: primary.number };
  } catch (error: any) {
    // A failing fallback must not turn "this branch has no PR" into an error: the
    // `gh pr list` leg already proved `gh` is healthy by the time we get here.
    log.debug('[findPullRequestByCommit] failed', { code: error?.code, sha });
    return undefined;
  }
};

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
 * The PR linked to a branch, resolved cheapest-signal-first:
 *
 * 1. a saved PR number → `gh pr view` (the strongest link once one is known);
 * 2. the branch's REMOTE ref → `gh pr list --head`, including merged/closed PRs so
 *    stale topic snapshots refresh lifecycle state after GitHub changes outside the app;
 * 3. nothing found and no remote ref was ever established → `gh` commit→PR lookup.
 *
 * Step 2 is the fix for the bug this chain existed to have: the head passed to
 * `gh` is the branch that exists ON THE REMOTE, not the local branch name. The two
 * diverge routinely — a worktree generates its own local name, and a push with an
 * explicit refspec (`git push origin local:remote`) renames the branch in flight —
 * and querying the local name in that state returns an empty list forever, so the
 * PR silently never links. Step 3 then covers the case where the local repo holds
 * no trace of the push at all.
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

  const viewPullRequest = async (number: number): Promise<GithubPullRequestPayload> => {
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
    const { sha, upstream: localUpstream } = branch
      ? await resolveUpstream(dirPath, branch)
      : { sha: undefined, upstream: undefined };

    if (pullRequestNumber !== undefined) {
      const parsed = await viewPullRequest(pullRequestNumber);
      const upstream = await toUpstreamRef(dirPath, parsed.headRefName, localUpstream);
      return {
        pullRequest: normalizeGithubPullRequest(parsed),
        status: 'ok',
        ...(upstream ? { upstream } : {}),
      };
    }

    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--head',
        localUpstream?.branch ?? branch,
        '--state',
        'all',
        '--limit',
        '5',
        '--json',
        GITHUB_PULL_REQUEST_FIELDS,
      ],
      { cwd: dirPath, timeout: 8000 },
    );
    const parsed = JSON.parse(stdout.trim() || '[]') as GithubPullRequestPayload[];

    if (parsed.length > 0) {
      const [primaryRaw, ...rest] = parsed;
      const upstream = await toUpstreamRef(dirPath, primaryRaw.headRefName, localUpstream);
      return {
        extraCount: rest.length,
        pullRequest: normalizeGithubPullRequest(primaryRaw),
        status: 'ok',
        ...(upstream ? { upstream } : {}),
      };
    }

    // Empty. With a resolved remote ref that is a real answer — the branch has no PR.
    // Without one, the head we just queried was only the local NAME, a guess, so the
    // empty list proves nothing: ask GitHub by commit instead — but only about a commit
    // that is the branch's own work, never one it merely forked from.
    if (!localUpstream && sha && (await isCommitSafeForPullRequestLookup(dirPath, sha))) {
      const recovered = await findPullRequestByCommit(dirPath, sha);
      if (recovered) {
        const upstream = await toUpstreamRef(dirPath, recovered.headRefName);
        return {
          pullRequest: normalizeGithubPullRequest(await viewPullRequest(recovered.number)),
          status: 'ok',
          ...(upstream ? { upstream } : {}),
        };
      }
    }

    return {
      pullRequest: null,
      status: 'ok',
      ...(localUpstream ? { upstream: localUpstream } : {}),
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
