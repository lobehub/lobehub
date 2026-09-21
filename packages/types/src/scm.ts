/**
 * SCM (source control management) integration domain: a LobeHub-owned app
 * installed on a provider account, the provider identities of LobeHub users,
 * and the change requests (GitHub pull requests, GitLab merge requests, …)
 * that agents open and the provider reports back on.
 *
 * Every vocabulary here is provider-neutral on purpose: the tables carry a
 * `provider` column, and provider-specific payload shapes are normalized into
 * these unions before they reach the database. Only `github` is implemented
 * today; adding a provider means adding a normalizer, not a migration.
 */

/** Providers the SCM integration can talk to. Only `github` ships today. */
export const SCM_PROVIDERS = ['github'] as const;
export type ScmProvider = (typeof SCM_PROVIDERS)[number];

/** Provider account kind an installation lives on. */
export type ScmInstallationAccountType = 'organization' | 'user';

/** Whether the installation covers every repository of the account or a chosen subset. */
export type ScmRepositorySelection = 'all' | 'selected';

/** One repository granted to an installation. Snapshot maintained from provider events. */
export interface ScmInstallationRepository {
  externalId: string;
  /** `owner/name` as the provider prints it. */
  fullName: string;
  private?: boolean;
}

/**
 * Open bag for provider-specific installation facts that are safe to read
 * without decryption (display names, avatar, granted permissions).
 */
export interface ScmInstallationMetadata {
  [key: string]: unknown;
  accountAvatarUrl?: string;
  /** Provider event names the installation subscribed to. */
  events?: string[];
  /** Provider-granted permission map, e.g. `{ pull_requests: 'write' }`. */
  permissions?: Record<string, string>;
}

/** Open bag for a linked provider identity (avatar, email, granted scope). */
export interface ScmIdentityMetadata {
  [key: string]: unknown;
  avatarUrl?: string;
  email?: string;
  scope?: string;
}

/** Lifecycle of a change request, collapsed across providers. */
export type ScmChangeRequestState = 'closed' | 'merged' | 'open';

/** Rolled-up continuous-integration outcome for the change request's head commit. */
export type ScmCiStatus = 'failure' | 'pending' | 'success' | 'unknown';

/** Provider review verdict for the change request as a whole. */
export type ScmReviewDecision = 'approved' | 'changes_requested' | 'review_required';

/** Outcome of one CI check on the current head commit. */
export interface ScmCheck {
  completedAt?: string;
  /** Provider conclusion, e.g. `success` | `failure` | `cancelled` | `skipped`. */
  conclusion?: string;
  externalId: string;
  name: string;
  startedAt?: string;
  /** Provider status, e.g. `queued` | `in_progress` | `completed`. */
  status: string;
  url?: string;
}

/**
 * What a normalized provider event meant for the change request. Drives the
 * closed loop: `merged` accepts the linked acceptance, `ci_failed` /
 * `review_changes_requested` wake the agent that opened it.
 */
export type ScmChangeRequestEventKind =
  | 'ci_failed'
  | 'ci_passed'
  | 'closed'
  | 'conflict'
  | 'merged'
  | 'opened'
  | 'ready_for_review'
  | 'reopened'
  | 'review_approved'
  | 'review_changes_requested'
  | 'review_commented'
  | 'synchronized';

/** Open bag for change-request facts the columns do not model. */
export interface ScmChangeRequestMetadata {
  [key: string]: unknown;
  /** Acceptance links parsed out of the change request body. */
  acceptanceIdsFromBody?: string[];
  /** Provider's mergeability verdict, when it exposes one (`MERGEABLE`, `CONFLICTING`, …). */
  mergeable?: string;
}

/** Processing state of one inbound webhook delivery. */
export type ScmWebhookDeliveryStatus = 'failed' | 'processed' | 'received' | 'skipped';
