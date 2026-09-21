import type {
  ScmChangeRequestEventKind,
  ScmChangeRequestSnapshot,
  ScmChangeRequestState,
  ScmCheck,
  ScmInstallationRepository,
  ScmInstallationSnapshot,
} from '@lobechat/types';

import type { ScmActor, ScmInboundEvent } from '../types';

/**
 * Translate raw GitHub webhook payloads into provider-neutral
 * {@link ScmInboundEvent}s. Pure: no I/O, no database. Everything the ingest
 * service needs must be derivable from the payload alone; the few reads that
 * need the API (installation repositories on install) happen in the install
 * callback, not here.
 *
 * Payload shapes follow the GitHub webhook reference. Fields are read
 * defensively — GitHub adds fields freely and drops none, so missing means
 * "not applicable", never "malformed".
 */

type Json = Record<string, any>;

const str = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

const date = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const actor = (user: Json | null | undefined): ScmActor | undefined =>
  user && user.id !== undefined && user.login
    ? { externalId: String(user.id), login: String(user.login) }
    : undefined;

const repository = (repo: Json | null | undefined): ScmInstallationRepository | null =>
  repo && repo.full_name
    ? {
        externalId: String(repo.id),
        fullName: String(repo.full_name),
        private: repo.private === true,
      }
    : null;

const installationSnapshot = (installation: Json): ScmInstallationSnapshot => ({
  accountExternalId: String(installation.account?.id ?? ''),
  accountLogin: String(installation.account?.login ?? ''),
  accountType: installation.account?.type === 'User' ? 'user' : 'organization',
  installationId: String(installation.id),
  metadata: {
    accountAvatarUrl: installation.account?.avatar_url,
    events: Array.isArray(installation.events) ? installation.events : undefined,
    permissions: installation.permissions,
  },
  provider: 'github',
  repositorySelection: installation.repository_selection === 'selected' ? 'selected' : 'all',
  suspendedAt: date(installation.suspended_at),
});

const pullRequestState = (pr: Json): ScmChangeRequestState => {
  if (pr.merged === true || pr.merged_at) return 'merged';
  return pr.state === 'closed' ? 'closed' : 'open';
};

const pullRequestSnapshot = (repo: Json, pr: Json): ScmChangeRequestSnapshot => ({
  authorExternalId: str(pr.user?.id),
  authorExternalLogin: str(pr.user?.login),
  baseRef: str(pr.base?.ref),
  closedAt: date(pr.closed_at),
  externalId: str(pr.node_id),
  headRef: str(pr.head?.ref),
  headSha: str(pr.head?.sha),
  isDraft: pr.draft === true,
  mergeStateStatus: str(pr.mergeable_state)?.toUpperCase() ?? null,
  mergedAt: date(pr.merged_at),
  mergedByExternalId: str(pr.merged_by?.id),
  metadata:
    pr.mergeable === null || pr.mergeable === undefined ? {} : { mergeable: String(pr.mergeable) },
  number: Number(pr.number),
  provider: 'github',
  repoExternalId: str(repo.id),
  repoFullName: String(repo.full_name),
  state: pullRequestState(pr),
  title: str(pr.title),
  url: String(pr.html_url),
});

const PULL_REQUEST_ACTION_KINDS: Record<string, ScmChangeRequestEventKind> = {
  converted_to_draft: 'synchronized',
  edited: 'synchronized',
  opened: 'opened',
  ready_for_review: 'ready_for_review',
  reopened: 'reopened',
  synchronize: 'synchronized',
};

const normalizePullRequest = (payload: Json): ScmInboundEvent => {
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = str(payload.installation?.id);
  if (!pr || !repo || !installationId)
    return { reason: 'pull_request payload incomplete', type: 'ignored' };

  const action = String(payload.action);
  let kind: ScmChangeRequestEventKind | undefined;
  if (action === 'closed') kind = pr.merged === true ? 'merged' : 'closed';
  else kind = PULL_REQUEST_ACTION_KINDS[action];

  if (!kind) return { reason: `pull_request action ${action} not tracked`, type: 'ignored' };

  return {
    actor: actor(payload.sender),
    body: typeof pr.body === 'string' ? pr.body : null,
    changeRequest: pullRequestSnapshot(repo, pr),
    installationId,
    kind,
    occurredAt: date(pr.updated_at) ?? undefined,
    type: 'change_request',
  };
};

const REVIEW_STATE_KINDS: Record<
  string,
  'review_approved' | 'review_changes_requested' | 'review_commented'
> = {
  approved: 'review_approved',
  changes_requested: 'review_changes_requested',
  commented: 'review_commented',
};

const normalizePullRequestReview = (payload: Json): ScmInboundEvent => {
  const action = String(payload.action);
  // `dismissed` is tracked too: GitHub has invalidated the review, so the
  // stored decision has to be cleared rather than left standing.
  if (action !== 'submitted' && action !== 'dismissed') {
    return { reason: `pull_request_review action ${action} not tracked`, type: 'ignored' };
  }
  const review = payload.review;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = str(payload.installation?.id);
  if (!review || !pr || !repo || !installationId) {
    return { reason: 'pull_request_review payload incomplete', type: 'ignored' };
  }

  const kind =
    action === 'dismissed'
      ? ('review_dismissed' as const)
      : REVIEW_STATE_KINDS[String(review.state).toLowerCase()];
  if (!kind) return { reason: `review state ${review.state} not tracked`, type: 'ignored' };

  return {
    actor: actor(review.user),
    installationId,
    kind,
    number: Number(pr.number),
    // A dismissal happens now; `submitted_at` still names the original review.
    occurredAt: action === 'dismissed' ? undefined : (date(review.submitted_at) ?? undefined),
    repoFullName: String(repo.full_name),
    review: {
      body: typeof review.body === 'string' ? review.body : null,
      externalId: String(review.id),
      url: str(review.html_url),
    },
    type: 'review',
  };
};

const normalizePullRequestReviewComment = (payload: Json): ScmInboundEvent => {
  if (payload.action !== 'created') {
    return {
      reason: `pull_request_review_comment action ${payload.action} not tracked`,
      type: 'ignored',
    };
  }
  const comment = payload.comment;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = str(payload.installation?.id);
  if (!comment || !pr || !repo || !installationId) {
    return { reason: 'pull_request_review_comment payload incomplete', type: 'ignored' };
  }

  return {
    actor: actor(comment.user),
    installationId,
    kind: 'review_commented',
    number: Number(pr.number),
    occurredAt: date(comment.created_at) ?? undefined,
    repoFullName: String(repo.full_name),
    review: {
      body: typeof comment.body === 'string' ? comment.body : null,
      externalId: `comment:${comment.id}`,
      line: typeof comment.line === 'number' ? comment.line : (comment.original_line ?? null),
      path: str(comment.path),
      url: str(comment.html_url),
    },
    type: 'review',
  };
};

const checkFromRun = (run: Json): ScmCheck => ({
  completedAt: str(run.completed_at) ?? undefined,
  conclusion: str(run.conclusion) ?? undefined,
  externalId: `check_run:${run.id}`,
  name: String(run.name ?? run.id),
  startedAt: str(run.started_at) ?? undefined,
  status: String(run.status ?? 'queued'),
  url: str(run.html_url ?? run.details_url) ?? undefined,
});

const pullRequestNumbers = (list: unknown): number[] =>
  Array.isArray(list)
    ? list.map((item) => Number(item?.number)).filter((n) => Number.isFinite(n))
    : [];

const normalizeCheckRun = (payload: Json): ScmInboundEvent => {
  const run = payload.check_run;
  const repo = payload.repository;
  const installationId = str(payload.installation?.id);
  if (!run || !repo || !installationId || !run.head_sha) {
    return { reason: 'check_run payload incomplete', type: 'ignored' };
  }

  return {
    checks: [checkFromRun(run)],
    headSha: String(run.head_sha),
    installationId,
    numbers: pullRequestNumbers(run.pull_requests),
    repoFullName: String(repo.full_name),
    type: 'checks',
  };
};

/** Legacy commit statuses (external CI posting to the Status API) fold into the same check set. */
const normalizeStatus = (payload: Json): ScmInboundEvent => {
  const repo = payload.repository;
  const installationId = str(payload.installation?.id);
  if (!payload.sha || !repo || !installationId || !payload.context) {
    return { reason: 'status payload incomplete', type: 'ignored' };
  }

  const state = String(payload.state);
  const completed = state !== 'pending';
  return {
    checks: [
      {
        completedAt: completed ? (str(payload.updated_at) ?? undefined) : undefined,
        conclusion: completed ? (state === 'success' ? 'success' : 'failure') : undefined,
        externalId: `status:${payload.context}`,
        name: String(payload.context),
        status: completed ? 'completed' : 'in_progress',
        url: str(payload.target_url) ?? undefined,
      },
    ],
    headSha: String(payload.sha),
    installationId,
    numbers: [],
    repoFullName: String(repo.full_name),
    type: 'checks',
  };
};

const normalizeInstallation = (payload: Json): ScmInboundEvent => {
  const installation = payload.installation;
  if (!installation?.id) return { reason: 'installation payload incomplete', type: 'ignored' };

  const action = String(payload.action);
  if (
    !['created', 'deleted', 'new_permissions_accepted', 'suspend', 'unsuspend'].includes(action)
  ) {
    return { reason: `installation action ${action} not tracked`, type: 'ignored' };
  }

  const repositories = Array.isArray(payload.repositories)
    ? payload.repositories.map(repository).filter((r: ScmInstallationRepository | null) => !!r)
    : [];

  return {
    action: action as 'created' | 'deleted' | 'new_permissions_accepted' | 'suspend' | 'unsuspend',
    installation: { ...installationSnapshot(installation), repositories },
    type: 'installation',
  };
};

const normalizeInstallationRepositories = (payload: Json): ScmInboundEvent => {
  const installationId = str(payload.installation?.id);
  if (!installationId)
    return { reason: 'installation_repositories payload incomplete', type: 'ignored' };

  const list = (items: unknown) =>
    Array.isArray(items)
      ? items.map(repository).filter((r): r is ScmInstallationRepository => !!r)
      : [];

  return {
    added: list(payload.repositories_added),
    installationId,
    removed: list(payload.repositories_removed),
    type: 'installation_repositories',
  };
};

/**
 * Entry point: `event` is the `X-GitHub-Event` header. Unknown events are
 * ignored (not errors) so subscribing to more events on the App never
 * produces failed deliveries.
 */
export const normalizeGitHubEvent = (event: string, payload: Json): ScmInboundEvent => {
  switch (event) {
    case 'pull_request': {
      return normalizePullRequest(payload);
    }
    case 'pull_request_review': {
      return normalizePullRequestReview(payload);
    }
    case 'pull_request_review_comment': {
      return normalizePullRequestReviewComment(payload);
    }
    case 'check_run': {
      return normalizeCheckRun(payload);
    }
    case 'status': {
      return normalizeStatus(payload);
    }
    case 'installation': {
      return normalizeInstallation(payload);
    }
    case 'installation_repositories': {
      return normalizeInstallationRepositories(payload);
    }
    // `check_suite` and `workflow_run` are aggregates of `check_run`; the run-level
    // events already carry every check with its name and conclusion.
    default: {
      return { reason: `event ${event} not tracked`, type: 'ignored' };
    }
  }
};

/** Pull the request-level facts a delivery ledger row records, without normalizing. */
export const describeGitHubDelivery = (payload: Json) => ({
  action: str(payload.action),
  installationId: str(payload.installation?.id),
  number:
    typeof payload.pull_request?.number === 'number'
      ? payload.pull_request.number
      : typeof payload.number === 'number'
        ? payload.number
        : null,
  repoFullName: str(payload.repository?.full_name),
});
