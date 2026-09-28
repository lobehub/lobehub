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

/**
 * How the provider relates an actor to the repository. GitHub's
 * `author_association`, lower-cased; `none` covers a passer-by.
 */
export type ScmActorAssociation =
  'collaborator' | 'contributor' | 'member' | 'none' | 'owner' | 'unknown';

/**
 * Associations whose word is trusted enough to steer an unattended agent.
 * Anyone below this bar can still comment; their text simply does not
 * become an instruction with tools behind it.
 */
export const SCM_TRUSTED_ASSOCIATIONS: ReadonlySet<ScmActorAssociation> = new Set([
  'collaborator',
  'member',
  'owner',
]);

/**
 * Review bots whose feedback may steer the agent even though the provider
 * reports them as `none` (GitHub App bots never hold an association). Only
 * a repository admin can install such an app, and the `[bot]` suffix cannot
 * be taken by a user account, so the login alone identifies it.
 */
export const SCM_TRUSTED_REVIEW_BOTS: ReadonlySet<string> = new Set([
  'chatgpt-codex-connector[bot]',
]);

/** Whether an actor's review text may become an instruction for an unattended agent. */
export const isTrustedScmReviewer = (actor: {
  association?: ScmActorAssociation;
  login?: string;
}): boolean =>
  (!!actor.association && SCM_TRUSTED_ASSOCIATIONS.has(actor.association)) ||
  (!!actor.login && SCM_TRUSTED_REVIEW_BOTS.has(actor.login));

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
  /**
   * Provider app that published the check. Two apps may report the same
   * name for one commit, so the source is part of a check's identity —
   * without it a passing `Test` from one app would erase a failing `Test`
   * from another and turn the rollup green.
   */
  appId?: string;
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
   * Who is currently posting the tracking comment, as an ISO timestamp.
   * Taken atomically so concurrent deliveries cannot each post one; goes
   * stale on its own if the post never finishes.
   */
  commentClaimedAt?: string;
  /**
   * Provider-clock timestamp of the newest change-request event applied.
   * Kept apart from the `lastEventAt` column, which also records events we
   * time with our own clock (check results), so ordering only ever compares
   * two provider timestamps.
   */
  lastProviderEventAt?: string;
  /** The most recent time the agent was notified about this change request, and why. */
  lastWake?: { at: string; reason: string };
  /** Provider id of the LobeHub comment posted on this change request, once posted. */
  lobehubCommentId?: string;
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
   * A wake the debounce window swallowed. The next event on this change
   * request delivers it, so the last failure of a burst is not lost.
   */
  pendingWake?: { reason: string; since: string };
  /** Whether the repository is private, when the provider said. Drives the comment switches. */
  repoPrivate?: boolean;
  /**
   * Latest effective verdict per reviewer, keyed by provider user id. The
   * change request's `reviewDecision` is the rollup of these: one
   * outstanding "changes requested" outweighs any number of approvals,
   * whatever order the deliveries arrive in.
   */
  reviewers?: Record<string, { at?: string; decision: 'approved' | 'changes_requested' }>;
  /**
   * How the owner was decided. `author` rows point at a person's records
   * wherever they live, so every action on them rechecks that the person
   * can still write there; `installation` rows (and rows written before
   * author routing, which carry nothing) belong to the installation's
   * tenant and need no such check.
   */
  routedBy?: 'author' | 'installation';
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
  /**
   * The owner below is only a fallback for a row that does not exist yet:
   * an existing row keeps its owner, workspace and `routedBy`. Decided
   * under the row lock, so a delivery that resolved nothing cannot move a
   * row another delivery just routed.
   */
  keepOwner?: boolean;
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
