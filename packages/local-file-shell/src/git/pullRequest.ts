import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import type {
  GitPullRequestAction,
  GitPullRequestActionResult,
  GitPullRequestCheck,
  GitPullRequestDetail,
  GitPullRequestDetailResult,
} from './types';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

const GITHUB_PULL_REQUEST_DETAIL_FIELDS =
  'number,title,body,state,isDraft,isCrossRepository,mergedAt,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,baseRefName,headRefName,url,author,additions,deletions,changedFiles,commits,comments,reviews,statusCheckRollup';

type GithubPullRequestAuthor = { login?: string | null } | null;

type GithubPullRequestCommit = {
  authors?: { login?: string | null }[] | null;
  committedDate?: string | null;
  messageHeadline?: string | null;
  oid: string;
};

type GithubPullRequestComment = {
  author?: GithubPullRequestAuthor;
  body?: string | null;
  createdAt?: string | null;
  id: string;
};

type GithubPullRequestReview = {
  author?: GithubPullRequestAuthor;
  state: string;
  submittedAt?: string | null;
};

type GithubStatusCheckRollupNode = {
  completedAt?: string | null;
  conclusion?: string | null;
  context?: string | null;
  createdAt?: string | null;
  detailsUrl?: string | null;
  name?: string | null;
  startedAt?: string | null;
  state?: string | null;
  status?: string | null;
  targetUrl?: string | null;
};

type GithubPullRequestDetailPayload = {
  additions: number;
  author?: GithubPullRequestAuthor;
  autoMergeRequest?: { mergeMethod?: string | null } | null;
  baseRefName: string;
  body?: string | null;
  changedFiles: number;
  comments?: GithubPullRequestComment[] | null;
  commits?: GithubPullRequestCommit[] | null;
  deletions: number;
  headRefName: string;
  isCrossRepository?: boolean;
  isDraft?: boolean;
  mergeable?: string | null;
  mergedAt?: string | null;
  mergeStateStatus?: string | null;
  number: number;
  reviewDecision?: string | null;
  reviews?: GithubPullRequestReview[] | null;
  state: string;
  statusCheckRollup?: GithubStatusCheckRollupNode[] | null;
  title: string;
  url: string;
};

export type GithubRepoInfo = { name: string; owner: string; viewerPermission?: string | null };

const failureConclusions = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'timed_out',
]);
const successConclusions = new Set(['neutral', 'skipped', 'success']);

const toLowerOrUndefined = (value?: string | null) => value?.toLowerCase();

const normalizeCheckStatus = (node: GithubStatusCheckRollupNode): GitPullRequestCheck['status'] => {
  const state = toLowerOrUndefined(node.state);
  if (state) {
    if (state === 'success') return 'success';
    if (state === 'failure' || state === 'error') return 'failure';
    return 'pending';
  }

  const status = toLowerOrUndefined(node.status);
  if (status && status !== 'completed') return 'pending';

  const conclusion = toLowerOrUndefined(node.conclusion);
  if (conclusion === 'skipped') return 'skipped';
  if (conclusion === 'cancelled') return 'cancelled';
  if (conclusion && successConclusions.has(conclusion))
    return conclusion === 'neutral' ? 'neutral' : 'success';
  if (conclusion && failureConclusions.has(conclusion)) return 'failure';
  return 'pending';
};

const normalizeCheck = (
  node: GithubStatusCheckRollupNode,
  requiredChecks: Set<string>,
): GitPullRequestCheck => {
  const name = node.name ?? node.context ?? '';
  const detailsUrl = node.detailsUrl ?? node.targetUrl ?? undefined;
  const startedAt = node.startedAt ?? node.createdAt ?? undefined;

  return {
    ...(node.completedAt ? { completedAt: node.completedAt } : {}),
    ...(detailsUrl ? { detailsUrl } : {}),
    name,
    required: requiredChecks.has(name),
    ...(startedAt ? { startedAt } : {}),
    status: normalizeCheckStatus(node),
  };
};

const toMergeMethod = (raw?: string | null): 'merge' | 'rebase' | 'squash' | undefined => {
  const lower = toLowerOrUndefined(raw);
  if (lower === 'merge' || lower === 'rebase' || lower === 'squash') return lower;
  return undefined;
};

export const normalizePullRequestDetail = (
  raw: GithubPullRequestDetailPayload,
  repo: GithubRepoInfo,
  requiredChecks: Set<string>,
): GitPullRequestDetail => {
  const viewerPermission = repo.viewerPermission ?? '';
  const autoMergeMethod = toMergeMethod(raw.autoMergeRequest?.mergeMethod);

  return {
    additions: raw.additions,
    author: raw.author?.login ?? '',
    autoMerge: autoMergeMethod ? { method: autoMergeMethod } : null,
    baseRefName: raw.baseRefName,
    body: raw.body ?? '',
    changedFiles: raw.changedFiles,
    checks: (raw.statusCheckRollup ?? []).map((node) => normalizeCheck(node, requiredChecks)),
    comments: (raw.comments ?? []).map((comment) => ({
      author: comment.author?.login ?? '',
      body: comment.body ?? '',
      createdAt: comment.createdAt ?? '',
      id: comment.id,
    })),
    commits: (raw.commits ?? []).map((commit) => ({
      author: commit.authors?.[0]?.login ?? '',
      committedAt: commit.committedDate ?? '',
      message: commit.messageHeadline ?? '',
      sha: commit.oid,
    })),
    deletions: raw.deletions,
    headRefName: raw.headRefName,
    isCrossRepository: raw.isCrossRepository ?? false,
    isDraft: raw.isDraft ?? false,
    mergeable: (raw.mergeable as GitPullRequestDetail['mergeable']) ?? 'UNKNOWN',
    ...(raw.mergedAt ? { mergedAt: raw.mergedAt } : {}),
    mergeStateStatus:
      (raw.mergeStateStatus as GitPullRequestDetail['mergeStateStatus']) ?? 'UNKNOWN',
    number: raw.number,
    repo: { name: repo.name, owner: repo.owner },
    reviewDecision: (raw.reviewDecision || null) as GitPullRequestDetail['reviewDecision'],
    reviews: (raw.reviews ?? []).map((review) => ({
      author: review.author?.login ?? '',
      state: review.state as GitPullRequestDetail['reviews'][number]['state'],
      submittedAt: review.submittedAt ?? '',
    })),
    state: raw.mergedAt ? 'merged' : toLowerOrUndefined(raw.state) === 'closed' ? 'closed' : 'open',
    title: raw.title,
    url: raw.url,
    viewerCanBypass: viewerPermission === 'ADMIN',
    viewerCanWrite:
      viewerPermission === 'ADMIN' ||
      viewerPermission === 'MAINTAIN' ||
      viewerPermission === 'WRITE',
  };
};

const getRequiredStatusCheckNames = async (
  dirPath: string,
  repo: { name: string; owner: string },
  baseRefName: string,
): Promise<Set<string>> => {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        `repos/${repo.owner}/${repo.name}/branches/${baseRefName}/protection/required_status_checks`,
      ],
      { cwd: dirPath, timeout: 8000 },
    );
    const parsed = JSON.parse(stdout.trim() || '{}') as {
      checks?: { context: string }[];
      contexts?: string[];
    };
    return new Set([
      ...(parsed.contexts ?? []),
      ...(parsed.checks?.map((check) => check.context) ?? []),
    ]);
  } catch {
    // No branch protection, no admin access to read it, or gh failed — treat as none required.
    return new Set();
  }
};

const isGhMissing = (error: any): boolean => {
  const code = error?.code;
  const stderr: string = error?.stderr ?? '';
  return code === 'ENOENT' || /auth\s+login|not\s+logged\s+in|authentication/i.test(stderr);
};

export const getPullRequestDetail = async (payload: {
  number: number;
  path: string;
}): Promise<GitPullRequestDetailResult> => {
  const { path: dirPath, number } = payload;

  try {
    const [{ stdout: prStdout }, { stdout: repoStdout }] = await Promise.all([
      execFileAsync(
        'gh',
        ['pr', 'view', String(number), '--json', GITHUB_PULL_REQUEST_DETAIL_FIELDS],
        {
          cwd: dirPath,
          timeout: 8000,
        },
      ),
      execFileAsync('gh', ['repo', 'view', '--json', 'owner,name,viewerPermission'], {
        cwd: dirPath,
        timeout: 8000,
      }),
    ]);

    const raw = JSON.parse(prStdout.trim() || '{}') as GithubPullRequestDetailPayload;
    const repoRaw = JSON.parse(repoStdout.trim() || '{}') as {
      name: string;
      owner?: { login?: string };
      viewerPermission?: string;
    };
    const repo: GithubRepoInfo = {
      name: repoRaw.name,
      owner: repoRaw.owner?.login ?? '',
      viewerPermission: repoRaw.viewerPermission,
    };

    const requiredChecks = await getRequiredStatusCheckNames(dirPath, repo, raw.baseRefName);

    return { detail: normalizePullRequestDetail(raw, repo, requiredChecks), status: 'ok' };
  } catch (error: any) {
    if (isGhMissing(error)) return { detail: null, status: 'gh-missing' };
    log.debug('[getPullRequestDetail] failed', {
      code: error?.code,
      number,
      stderr: error?.stderr,
    });
    return { detail: null, status: 'error' };
  }
};

const VALID_BRANCH_NAME = /^[\w./-]+$/;

export const pullRequestActionArgs = (number: number, action: GitPullRequestAction): string[][] => {
  const n = String(number);

  switch (action.type) {
    case 'merge': {
      const argv = ['pr', 'merge', n, `--${action.method}`];
      if (action.admin) argv.push('--admin');
      if (action.deleteBranch) argv.push('--delete-branch');
      return [argv];
    }
    case 'autoMerge': {
      return [['pr', 'merge', n, '--auto', `--${action.method}`]];
    }
    case 'disableAutoMerge': {
      return [['pr', 'merge', n, '--disable-auto']];
    }
    case 'updateBranch': {
      return [
        action.method === 'rebase'
          ? ['pr', 'update-branch', n, '--rebase']
          : ['pr', 'update-branch', n],
      ];
    }
    case 'ready': {
      return [['pr', 'ready', n]];
    }
    case 'comment': {
      return [['pr', 'comment', n, '--body', action.body]];
    }
    case 'close': {
      return [['pr', 'close', n]];
    }
    case 'reopen': {
      return [['pr', 'reopen', n]];
    }
    case 'deleteBranch': {
      const segments = action.head.split('/');
      if (!VALID_BRANCH_NAME.test(action.head) || segments.includes('..'))
        throw new Error('Invalid branch name');
      return [['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${action.head}`]];
    }
  }
};

export const runPullRequestAction = async (payload: {
  action: GitPullRequestAction;
  number: number;
  path: string;
}): Promise<GitPullRequestActionResult> => {
  const { path: dirPath, number, action } = payload;

  try {
    for (const argv of pullRequestActionArgs(number, action)) {
      await execFileAsync('gh', argv, { cwd: dirPath, timeout: 60_000 });
    }
    return { success: true };
  } catch (error: any) {
    log.debug('[runPullRequestAction] failed', { action: action.type, code: error?.code, number });
    return {
      error: (error?.stderr as string)?.trim() || error?.message || 'unknown error',
      success: false,
    };
  }
};
