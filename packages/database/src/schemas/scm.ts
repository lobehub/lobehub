import type {
  ScmChangeRequestEventKind,
  ScmChangeRequestMetadata,
  ScmChangeRequestState,
  ScmCheck,
  ScmCiStatus,
  ScmIdentityMetadata,
  ScmInstallationAccountType,
  ScmInstallationMetadata,
  ScmInstallationRepository,
  ScmProvider,
  ScmRepositorySelection,
  ScmReviewDecision,
  ScmWebhookDeliveryStatus,
} from '@lobechat/types';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from './_helpers';
import { tasks } from './task';
import { topics } from './topic';
import { users } from './user';
import { acceptances } from './verify';
import { works } from './work';
import { workspaces } from './workspace';

/**
 * One installation of the LobeHub-owned SCM app (the GitHub App today) on a
 * provider account. Modeled after `messenger_installations`, with one
 * deliberate difference: **no credentials column**. A GitHub App mints
 * short-lived installation tokens from the app private key on demand, so
 * there is nothing durable to encrypt here — tokens live in the cache layer.
 *
 * `installation_id` is provider-opaque (GitHub `installation.id`; a GitLab
 * group hook id later). One installation binds to exactly one LobeHub scope
 * (personal user or workspace) in this version.
 */
export const scmInstallations = pgTable(
  'scm_installations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** LobeHub user who connected the installation; owns it in personal scope. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for a personal installation; set when connected from a workspace. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    provider: text('provider').$type<ScmProvider>().notNull(),
    /** Provider-side installation identifier. Unique within a provider. */
    installationId: varchar255('installation_id').notNull(),

    /** Provider account (`lobehub`) the app is installed on. */
    accountLogin: varchar255('account_login').notNull(),
    accountExternalId: varchar255('account_external_id').notNull(),
    accountType: text('account_type').$type<ScmInstallationAccountType>().notNull(),

    repositorySelection: text('repository_selection').$type<ScmRepositorySelection>().notNull(),
    /**
     * Repositories granted to the installation. Maintained from provider
     * `installation_repositories` events; may be empty when selection is `all`.
     */
    repositories: jsonb('repositories').$type<ScmInstallationRepository[]>().default([]).notNull(),

    /** Provider user who performed the install, bound at the OAuth callback. */
    installedByExternalUserId: varchar255('installed_by_external_user_id'),
    installedByExternalLogin: varchar255('installed_by_external_login'),

    /** Set on provider `suspend`; cleared on `unsuspend`. */
    suspendedAt: timestamptz('suspended_at'),
    /**
     * Set on provider `installation.deleted`. Rows are kept, not removed, so a
     * late delivery for a revoked installation short-circuits instead of
     * resurrecting it.
     */
    revokedAt: timestamptz('revoked_at'),

    metadata: jsonb('metadata').$type<ScmInstallationMetadata>().default({}).notNull(),

    ...timestamps,
  },
  (t) => [
    /** Routing key: every inbound event names its installation. */
    uniqueIndex('scm_installations_provider_installation_unique').on(t.provider, t.installationId),
    /** Supports personal-scope listing and user-deletion cascade. */
    index('scm_installations_user_id_idx').on(t.userId),
    /** Supports workspace-scope listing and workspace-deletion cascade. */
    index('scm_installations_workspace_id_idx').on(t.workspaceId),
    /** Supports "is this account already connected" lookups on the install page. */
    index('scm_installations_provider_account_idx').on(t.provider, t.accountLogin),
  ],
);

export type NewScmInstallation = typeof scmInstallations.$inferInsert;
export type ScmInstallationItem = typeof scmInstallations.$inferSelect;

/**
 * A LobeHub user's identity on a provider, captured when the user authorizes
 * the app during installation. Lets provider actors (`merged_by`, a reviewer)
 * resolve to LobeHub users, and holds the user-to-server token for acting on
 * the user's behalf later.
 *
 * Kept apart from `user_connectors`: that table backs the connector-data read
 * APIs and, on cloud, proxies its tokens through Market. This one is owned by
 * the SCM app end to end.
 */
export const scmIdentities = pgTable(
  'scm_identities',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    provider: text('provider').$type<ScmProvider>().notNull(),
    /** Provider user id — stable across renames. */
    externalUserId: varchar255('external_user_id').notNull(),
    externalLogin: varchar255('external_login').notNull(),

    /**
     * `KeyVaultsGateKeeper`-encrypted JSON `{ accessToken, refreshToken?, … }`
     * for the user-to-server token. Null when the user only identified
     * themselves without granting a token.
     */
    credentials: text('credentials'),
    /** Promoted out of `credentials` so a refresh job can index on it. */
    tokenExpiresAt: timestamptz('token_expires_at'),

    metadata: jsonb('metadata').$type<ScmIdentityMetadata>().default({}).notNull(),

    ...timestamps,
  },
  (t) => [
    /** One row per provider account. */
    uniqueIndex('scm_identities_provider_external_user_unique').on(t.provider, t.externalUserId),
    /** One provider identity per LobeHub user. */
    uniqueIndex('scm_identities_provider_user_unique').on(t.provider, t.userId),
    /** Supports the token refresh sweep. */
    index('scm_identities_token_expires_at_idx').on(t.tokenExpiresAt),
  ],
);

export type NewScmIdentity = typeof scmIdentities.$inferInsert;
export type ScmIdentityItem = typeof scmIdentities.$inferSelect;

/**
 * The hub row for one change request (GitHub pull request, GitLab merge
 * request). Three pre-existing records of the same PR converge here — the
 * `external` Work, the topic's working-directory snapshot, and the acceptance
 * round's `context.pullRequest` — so an inbound provider event has exactly one
 * place to look up which acceptance, topic and agent it belongs to.
 *
 * Addressed individually (acceptance page, CLI, tool payloads), hence the
 * prefixed id. Identity key is `(provider, repo_full_name, number)`; GitHub's
 * `node_id` is kept in `external_id` but is not the dedup key because the
 * `gh` CLI surface never returns it.
 */
export const scmChangeRequests = pgTable(
  'scm_change_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('scmChangeRequests'))
      .notNull(),

    /** Scope inherited from the installation the event arrived through. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    provider: text('provider').$type<ScmProvider>().notNull(),
    /** `owner/name` as the provider prints it. */
    repoFullName: varchar255('repo_full_name').notNull(),
    repoExternalId: varchar255('repo_external_id'),
    /** Provider-visible number (`#123`; GitLab `iid`). */
    number: integer('number').notNull(),
    /** Provider global id (GitHub `node_id`), when known. */
    externalId: varchar255('external_id'),
    url: text('url').notNull(),
    title: text('title'),
    authorExternalId: varchar255('author_external_id'),
    authorExternalLogin: varchar255('author_external_login'),

    headRef: varchar255('head_ref'),
    /** Head commit the current `checks` / `ci_status` describe. */
    headSha: varchar255('head_sha'),
    baseRef: varchar255('base_ref'),
    isDraft: boolean('is_draft').default(false).notNull(),

    state: text('state').$type<ScmChangeRequestState>().notNull(),
    mergedAt: timestamptz('merged_at'),
    closedAt: timestamptz('closed_at'),
    /** Provider user id of the merger; resolves through `scm_identities`. */
    mergedByExternalId: varchar255('merged_by_external_id'),

    ciStatus: text('ci_status').$type<ScmCiStatus>(),
    /**
     * Which head commit the CI rollup was computed for. A late check result
     * for an older commit must not overwrite the rollup of a newer push, so
     * writers compare this before applying.
     */
    ciHeadSha: varchar255('ci_head_sha'),
    checks: jsonb('checks').$type<ScmCheck[]>(),
    reviewDecision: text('review_decision').$type<ScmReviewDecision>(),
    /** Provider merge-state verdict (`CLEAN`, `BLOCKED`, `UNSTABLE`, …), shown as-is. */
    mergeStateStatus: varchar255('merge_state_status'),

    /** Installation the events arrive through. Set null so history survives an uninstall. */
    installationId: uuid('installation_id').references(() => scmInstallations.id, {
      onDelete: 'set null',
    }),
    /** Acceptance this change request delivers. Many-to-one: stacked PRs share one. */
    acceptanceId: uuid('acceptance_id').references(() => acceptances.id, { onDelete: 'set null' }),
    /** The `external` Work registered when the agent opened it. */
    workId: text('work_id').references(() => works.id, { onDelete: 'set null' }),
    /** Conversation that produced it; the wake target for CI / review events. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),

    /** Consecutive agent wakes on this change request; capped to stop CI ping-pong. */
    wakeCount: integer('wake_count').default(0).notNull(),
    lastWakeAt: timestamptz('last_wake_at'),
    lastEventAt: timestamptz('last_event_at'),
    lastEventKind: text('last_event_kind').$type<ScmChangeRequestEventKind>(),

    metadata: jsonb('metadata').$type<ScmChangeRequestMetadata>().default({}).notNull(),

    ...timestamps,
  },
  (t) => [
    /** Identity: one row per provider change request. */
    uniqueIndex('scm_change_requests_provider_repo_number_unique').on(
      t.provider,
      t.repoFullName,
      t.number,
    ),
    /** "Which PRs deliver this acceptance" — drives merge → accepted. */
    index('scm_change_requests_acceptance_id_idx').on(t.acceptanceId),
    /** Topic sidebar / wake-target lookups. */
    index('scm_change_requests_topic_id_idx').on(t.topicId),
    /** Work card ↔ change request join. */
    index('scm_change_requests_work_id_idx').on(t.workId),
    /** Uninstall cleanup and per-installation listing. */
    index('scm_change_requests_installation_id_idx').on(t.installationId),
    /** Personal listing ordered by recency; workspace listing filters on workspace_id first. */
    index('scm_change_requests_user_updated_at_idx').on(t.userId, t.updatedAt),
    index('scm_change_requests_workspace_id_idx').on(t.workspaceId),
    /** `check_suite` events name a commit, not a number. */
    index('scm_change_requests_head_sha_idx').on(t.headSha),
  ],
);

export type NewScmChangeRequest = typeof scmChangeRequests.$inferInsert;
export type ScmChangeRequestItem = typeof scmChangeRequests.$inferSelect;

/**
 * Idempotency and audit ledger for inbound webhook deliveries. The unique
 * index on `(provider, delivery_id)` is what rejects a redelivered event at
 * insert time, before any handler runs; the surrogate id keeps the row
 * individually addressable (retry tooling, future scope columns) without a
 * primary-key rebuild.
 *
 * Deliberately payload-free: GitHub retains 30 days of deliveries with a
 * one-click redeliver, which is the replay path. Rows age out after 30 days.
 */
export const scmWebhookDeliveries = pgTable(
  'scm_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    provider: text('provider').$type<ScmProvider>().notNull(),
    /** Provider delivery id (`X-GitHub-Delivery`). */
    deliveryId: varchar255('delivery_id').notNull(),

    /** Provider event name (`pull_request`, `check_suite`, …). */
    event: varchar255('event').notNull(),
    /** Provider event action (`closed`, `completed`, …), when the event has one. */
    action: varchar255('action'),
    /** Provider installation id as it appeared in the payload, before resolution. */
    installationId: varchar255('installation_id'),
    repoFullName: varchar255('repo_full_name'),
    number: integer('number'),

    status: text('status').$type<ScmWebhookDeliveryStatus>().notNull(),
    error: text('error'),

    receivedAt: timestamptz('received_at').defaultNow().notNull(),
    processedAt: timestamptz('processed_at'),
  },
  (t) => [
    /** Idempotency gate: one row per provider delivery. */
    uniqueIndex('scm_webhook_deliveries_provider_delivery_unique').on(t.provider, t.deliveryId),
    /** Retention sweep. */
    index('scm_webhook_deliveries_received_at_idx').on(t.receivedAt),
  ],
);

export type NewScmWebhookDelivery = typeof scmWebhookDeliveries.$inferInsert;
export type ScmWebhookDeliveryItem = typeof scmWebhookDeliveries.$inferSelect;
