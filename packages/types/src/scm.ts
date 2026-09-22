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
  /**
   * Provider-clock time this result was reported. Check runs and legacy
   * statuses reuse their external id as they transition, so deliveries that
   * arrive out of order are ordered by this rather than by arrival.
   */
  reportedAt?: string;
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
  | 'review_dismissed'
  | 'synchronized';

/** Open bag for change-request facts the columns do not model. */
export interface ScmChangeRequestMetadata {
  [key: string]: unknown;
  /** Acceptance links parsed out of the change request body. */
  acceptanceIdsFromBody?: string[];
  /**
   * Provider-clock timestamp of the newest change-request event applied.
   * Kept apart from the `lastEventAt` column, which also records events we
   * time with our own clock (check results), so ordering only ever compares
   * two provider timestamps.
   */
  lastProviderEventAt?: string;
  /** Provider's mergeability verdict, when it exposes one (`MERGEABLE`, `CONFLICTING`, …). */
  mergeable?: string;
  /**
   * Check results for a commit that is not the head yet. GitHub can report
   * a job before the `synchronize` that moves the pull request onto its
   * commit; holding them here keeps the push from landing with an empty CI
   * rollup when that job never reports again.
   */
  pendingChecks?: { checks: ScmCheck[]; sha: string };
  /**
   * Latest effective verdict per reviewer, keyed by provider user id. The
   * change request's `reviewDecision` is the rollup of these: one
   * outstanding "changes requested" outweighs any number of approvals,
   * whatever order the deliveries arrive in.
   */
  reviewers?: Record<string, { at?: string; decision: 'approved' | 'changes_requested' }>;
}

/** Processing state of one inbound webhook delivery. */
export type ScmWebhookDeliveryStatus = 'failed' | 'processed' | 'received' | 'skipped';

// ---------------------------------------------------------------------------
// Model contracts: the write shapes the SCM models accept and the read shapes
// they return. Row types (`ScmChangeRequestItem`, …) come from the database
// schema, so the results that carry a row are generic over it.
// ---------------------------------------------------------------------------

/** Provider facts about a change request, as a normalizer produces them from one event. */
export interface ScmChangeRequestSnapshot {
  authorExternalId?: string | null;
  authorExternalLogin?: string | null;
  baseRef?: string | null;
  closedAt?: Date | null;
  externalId?: string | null;
  headRef?: string | null;
  headSha?: string | null;
  isDraft?: boolean;
  mergedAt?: Date | null;
  mergedByExternalId?: string | null;
  mergeStateStatus?: string | null;
  metadata?: ScmChangeRequestMetadata;
  number: number;
  provider: ScmProvider;
  repoExternalId?: string | null;
  repoFullName: string;
  state: ScmChangeRequestState;
  title?: string | null;
  url: string;
}

/** The LobeHub records a change request is tied to. Only ever filled in, never cleared. */
export interface ScmChangeRequestLinks {
  acceptanceId?: string | null;
  installationId?: string | null;
  taskId?: string | null;
  topicId?: string | null;
  workId?: string | null;
}

export interface ScmUpsertChangeRequestParams extends ScmChangeRequestSnapshot {
  eventAt?: Date;
  eventKind?: ScmChangeRequestEventKind;
  links?: ScmChangeRequestLinks;
  userId: string;
  workspaceId?: string | null;
}

export interface ScmApplyChecksParams {
  checks: ScmCheck[];
  /** Commit the checks describe; a mismatch with the row's head is dropped as stale. */
  headSha: string;
  /** When true, `checks` replaces the stored set instead of merging by id. */
  replace?: boolean;
}

export interface ScmApplyChecksResult<TRow> {
  applied: boolean;
  ciStatus: ScmCiStatus | null;
  previousCiStatus: ScmCiStatus | null;
  row: TRow;
}

/** Provider facts about an installation, from a webhook or the installations API. */
export interface ScmInstallationSnapshot {
  accountExternalId: string;
  accountLogin: string;
  accountType: ScmInstallationAccountType;
  installationId: string;
  metadata?: ScmInstallationMetadata;
  provider: ScmProvider;
  repositories?: ScmInstallationRepository[];
  repositorySelection: ScmRepositorySelection;
  suspendedAt?: Date | null;
}

export interface ScmBindInstallationParams extends ScmInstallationSnapshot {
  installedByExternalLogin?: string | null;
  installedByExternalUserId?: string | null;
  userId: string;
  workspaceId?: string | null;
}

/** Plaintext user-to-server credentials; stored encrypted, never returned to a client. */
export interface ScmIdentityCredentials {
  accessToken: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}

export interface ScmUpsertIdentityParams {
  /** Plaintext credentials; encrypted before writing. Omit to keep the stored ones. */
  credentials?: ScmIdentityCredentials | null;
  externalLogin: string;
  externalUserId: string;
  metadata?: ScmIdentityMetadata;
  provider: ScmProvider;
  tokenExpiresAt?: Date | null;
  userId: string;
}

/** An identity row with its credential column decrypted. */
export type ScmDecryptedIdentity<TItem extends { credentials: unknown }> = Omit<
  TItem,
  'credentials'
> & { credentials: ScmIdentityCredentials | null };

export interface ScmClaimDeliveryParams {
  action?: string | null;
  deliveryId: string;
  event: string;
  installationId?: string | null;
  number?: number | null;
  provider: ScmProvider;
  repoFullName?: string | null;
}
