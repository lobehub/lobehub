import type {
  ChannelAuditDetails,
  ChannelExecutionConfig,
  ChannelInputManifest,
  ChannelJobBlockCode,
  ChannelJobStatus,
  ChannelMemberActorType,
  ChannelMemberConfig,
  ChannelMemberGrantMetadata,
  ChannelMemberGrantRevokeReason,
  ChannelMemberGrantStatus,
  ChannelMemberMetadata,
  ChannelMemberRole,
  ChannelMemberStatus,
  ChannelMessageMetadata,
  ChannelMessageRoutingSource,
  ChannelMessageRoutingStatus,
  ChannelMetadata,
  ChannelStatus,
  ChannelThreadMetadata,
  ChannelThreadStatus,
  ChannelVisibility,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, softDeleteColumns, timestamptz, updatedAt } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { files } from './file';
import { projects } from './project';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Channel: people and Agents in one shared conversation.
 *
 * Access is by membership, not by creator: a user reaches a channel only through an active
 * `channel_members` row. Every write first locks the `channels` row, then touches child rows,
 * so writers always take locks in the same order.
 *
 * Child tables expose `unique (channel_id, id)` so composite foreign keys keep every
 * reference inside its own channel.
 */
export const channels = pgTable(
  'channels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('channels'))
      .notNull(),
    /**
     * Creator and personal-channel device/cleanup boundary; the human participant of a direct
     * conversation. Channel access and role
     * permissions are checked through membership.
     * NULL once that account is deleted: a workspace channel outlives its creator, while
     * personal channels are deleted explicitly with the account (`UserModel.deleteUser`).
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** NULL for a personal channel. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Optional project association; deleting the project preserves the channel. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),

    /** Bound Agent for a direct conversation; NULL for a group. Deleted with the Agent. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    /** Last allocated message sequence; incremented under the row lock when a message lands. */
    sequence: integer('sequence').notNull().default(0),
    /** Lifecycle (`ChannelStatus`); trashing is the separate `is_deleted` below. */
    status: text('status').$type<ChannelStatus>().notNull().default('active'),

    /**
     * `public`: any workspace member can find and join. `private`: members only.
     * Ignored for personal channels.
     */
    visibility: text('visibility').$type<ChannelVisibility>().notNull().default('private'),
    metadata: jsonb('metadata').$type<ChannelMetadata>().default({}),
    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('channels_user_id_idx').on(t.userId),
    // One direct conversation per person, Agent and scope. The scope is part of the key because
    // an Agent can be transferred to another workspace; leading `agent_id` serves the cascade.
    uniqueIndex('channels_direct_unique')
      .on(t.agentId, t.userId, sql`coalesce(${t.workspaceId}, '')`)
      .where(sql`${t.agentId} IS NOT NULL`),
    check(
      'channels_direct_visibility_check',
      sql`${t.agentId} IS NULL OR ${t.visibility} = 'private'`,
    ),
    index('channels_project_id_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    index('channels_workspace_visibility_idx').on(t.workspaceId, t.visibility),
  ],
);

/**
 * People and Agents in a channel. Mentions, job participants, Thread followers and read
 * positions all reference this one member identity.
 */
export const channelMembers = pgTable(
  'channel_members',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    actorType: text('actor_type').$type<ChannelMemberActorType>().notNull(),

    // Human members
    /**
     * NULL once the account is deleted: retain the member for job and Thread references.
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    role: text('role').$type<ChannelMemberRole>(),
    /** Highest sequence this person has read in the main channel. */
    lastReadSequence: integer('last_read_sequence'),

    // Agent members
    /** NULL after Agent deletion; keep membership and authored history. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Channel routing/execution label; not an Agent configuration copy. */
    name: text('name'),
    description: text('description').notNull().default(''),
    /** Channel-specific device/directory environment only. */
    config: jsonb('config').$type<ChannelMemberConfig>(),
    metadata: jsonb('metadata').$type<ChannelMemberMetadata>().default({}),

    /** Former members keep their row for job and Thread references (`ChannelMemberStatus`). */
    status: text('status').$type<ChannelMemberStatus>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('channel_members_scope_unique').on(t.channelId, t.id),
    uniqueIndex('channel_members_channel_user_unique')
      .on(t.channelId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index('channel_members_user_id_idx').on(t.userId),
    index('channel_members_agent_id_idx').on(t.agentId),
    // One constraint per rule, so a new actor type adds constraints instead of rewriting these.
    check('channel_members_actor_type_check', sql`${t.actorType} IN ('user', 'agent')`),
    check(
      'channel_members_user_shape_check',
      sql`${t.actorType} <> 'user' OR ${t.role} IS NOT NULL`,
    ),
    check(
      'channel_members_agent_shape_check',
      sql`${t.actorType} <> 'agent' OR (${t.name} IS NOT NULL AND ${t.config} IS NOT NULL)`,
    ),
    // Membership lookups match on `user_id`, so only a person may carry one.
    check(
      'channel_members_user_id_owner_check',
      sql`${t.userId} IS NULL OR ${t.actorType} = 'user'`,
    ),
    check('channel_members_role_owner_check', sql`${t.role} IS NULL OR ${t.actorType} = 'user'`),
    check(
      'channel_members_agent_id_owner_check',
      sql`${t.agentId} IS NULL OR ${t.actorType} = 'agent'`,
    ),
    check(
      'channel_members_config_owner_check',
      sql`${t.config} IS NULL OR ${t.actorType} <> 'user'`,
    ),
  ],
);

/**
 * Approval to run an Agent member on someone's personal device (or a private shared one).
 * Binds to one (member, device, directory, environment revision); a switch needs a new grant.
 * An approved grant covers every current and future person in the channel.
 */
export const channelMemberGrants = pgTable(
  'channel_member_grants',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    memberId: uuid('member_id').notNull(),
    /** Device owner who approves, rejects or revokes. */
    deviceOwnerId: text('device_owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    deviceId: varchar('device_id', { length: 64 }).notNull(),
    /** Canonical path, so `/repo` and `/repo/` bind to the same grant. */
    workingDirectory: text('working_directory').notNull(),
    /** Person who pulled the member in or switched its environment. */
    requestedByMemberId: uuid('requested_by_member_id').notNull(),

    status: text('status').$type<ChannelMemberGrantStatus>().notNull().default('pending'),
    decidedAt: timestamptz('decided_at'),
    revokedAt: timestamptz('revoked_at'),
    revokeReason: text('revoke_reason').$type<ChannelMemberGrantRevokeReason>(),
    metadata: jsonb('metadata').$type<ChannelMemberGrantMetadata>().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('channel_member_grants_member_unique').on(t.memberId),
    index('channel_member_grants_owner_status_idx').on(t.deviceOwnerId, t.status),
    foreignKey({
      columns: [t.channelId, t.memberId],
      foreignColumns: [channelMembers.channelId, channelMembers.id],
      name: 'channel_member_grants_member_fk',
    }),
    foreignKey({
      columns: [t.channelId, t.requestedByMemberId],
      foreignColumns: [channelMembers.channelId, channelMembers.id],
      name: 'channel_member_grants_requester_fk',
    }),
  ],
);

export const channelAudit = pgTable(
  'channel_audit',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    /** e.g. `routing_decided`, `run_claimed`, `writer_isolated`. */
    event: text('event').notNull(),
    targetId: text('target_id').notNull(),
    details: jsonb('details').$type<ChannelAuditDetails>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('channel_audit_channel_event_idx').on(t.channelId, t.event, t.createdAt),
    index('channel_audit_target_event_idx').on(t.targetId, t.event, t.createdAt),
  ],
);

export const channelThreads = pgTable(
  'channel_threads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('channelThreads'))
      .notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    rootMessageId: uuid('root_message_id').notNull(),
    rootSequence: integer('root_sequence').notNull(),
    /** Member ids (people and Agents) following this Thread. */
    followerMemberIds: jsonb('follower_member_ids').$type<string[]>().notNull().default([]),
    /**
     * Lifecycle (`ChannelThreadStatus`). An archived Thread still holds its root, so the
     * uniqueness below excludes only trashed rows.
     */
    status: text('status').$type<ChannelThreadStatus>().notNull().default('active'),
    metadata: jsonb('metadata').$type<ChannelThreadMetadata>().default({}),
    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    createdAt: createdAt(),
  },
  // Threads and messages reference each other; the annotation breaks the type cycle.
  (t): PgTableExtraConfigValue[] => [
    unique('channel_threads_scope_unique').on(t.channelId, t.id),
    // One live Thread per root message; a trashed Thread keeps its row until restore or purge.
    uniqueIndex('channel_threads_root_unique')
      .on(t.channelId, t.rootMessageId)
      .where(sql`${t.isDeleted} IS NOT TRUE`),
    foreignKey({
      columns: [t.channelId, t.rootMessageId],
      foreignColumns: [channelMessages.channelId, channelMessages.id],
      name: 'channel_threads_root_fk',
    }),
  ],
);

/** Public Channel timeline, independent of Agent conversation messages. */
export const channelMessages = pgTable(
  'channel_messages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    threadId: text('thread_id'),
    sequence: integer('sequence').notNull(),
    content: text('content').notNull(),
    /** Actual human sender, not the owner/requester of an Agent reply. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Actual Agent sender. Author deletion retains group history and clears its reference. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Mentioned member ids. Mentioned Agents run; mentioned people are only notified. */
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    /** Client retry key for a human message; run identity for a published reply. */
    requestKey: text('request_key').notNull(),
    replyToId: uuid('reply_to_id'),

    routingStatus: text('routing_status').$type<ChannelMessageRoutingStatus>().notNull(),
    /** Where the recipients came from. NULL until routing settles, and on replies. */
    routingSource: text('routing_source').$type<ChannelMessageRoutingSource>(),
    /** Human-readable explanation of why these recipients (or none) were chosen. */
    routingReason: text('routing_reason'),
    /**
     * Incremented each time routing starts. A `decide()` result is written back only when its
     * attempt still matches, so a late answer cannot overwrite a retry.
     */
    routingAttempt: integer('routing_attempt').notNull().default(0),
    /** Agent member ids that actually received a job for this message. */
    recipientMemberIds: jsonb('recipient_member_ids').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<ChannelMessageMetadata>().default({}),

    createdAt: createdAt(),
  },
  // Threads and messages reference each other; the annotation breaks the type cycle.
  (t): PgTableExtraConfigValue[] => [
    unique('channel_messages_scope_unique').on(t.channelId, t.id),
    uniqueIndex('channel_messages_sequence_unique').on(t.channelId, t.sequence),
    uniqueIndex('channel_messages_request_key_unique').on(t.channelId, t.requestKey),
    index('channel_messages_thread_sequence_idx').on(t.channelId, t.threadId, t.sequence),
    /** Latest request per branch, without scanning Agent replies. */
    index('channel_messages_request_sequence_idx')
      .on(t.channelId, t.threadId, t.sequence)
      .where(sql`${t.routingStatus} <> 'reply'`),
    index('channel_messages_routing_pending_idx')
      .on(t.channelId, t.id)
      .where(sql`${t.routingStatus} = 'pending'`),
    foreignKey({
      columns: [t.channelId, t.threadId],
      foreignColumns: [channelThreads.channelId, channelThreads.id],
      name: 'channel_messages_thread_fk',
    }),
    // Both may be NULL after author deletion. Writers require one live sender on creation.
    check('channel_messages_sender_check', sql`${t.userId} IS NULL OR ${t.agentId} IS NULL`),
    check(
      'channel_messages_user_sender_check',
      sql`${t.routingStatus} <> 'reply' OR ${t.userId} IS NULL`,
    ),
    check(
      'channel_messages_agent_sender_check',
      sql`${t.routingStatus} = 'reply' OR ${t.agentId} IS NULL`,
    ),
  ],
);

/** Public attachment links are independent of internal conversation messages. */
export const channelMessageFiles = pgTable(
  'channel_message_files',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    messageId: uuid('message_id')
      .references(() => channelMessages.id, { onDelete: 'cascade' })
      .notNull(),
    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    unique('channel_message_files_message_file_unique').on(t.messageId, t.fileId),
    index('channel_message_files_file_idx').on(t.fileId),
  ],
);

/**
 * One delivery of one message to one Agent member; each member drains its jobs FIFO.
 *
 * Claiming a job reserves one canonical `agent_operations` row in a normal Agent
 * topic (continued when safe); execution status, errors, usage and traces live on the
 * operation. The job keeps only what the operation cannot: the frozen input, the execution
 * lease, the writer lock and publication of the final reply.
 */
export const channelJobs = pgTable(
  'channel_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    channelId: text('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    memberId: uuid('member_id').notNull(),
    messageId: uuid('message_id').notNull(),
    threadId: text('thread_id'),
    /** Member who triggered the request; its user is the execution identity. */
    requesterMemberId: uuid('requester_member_id').notNull(),
    /**
     * Channel outcome of this delivery. It may settle while the writer is still held, e.g. a
     * stop cancels the job before the process exits; the locks follow `writerHeld`.
     */
    status: text('status').$type<ChannelJobStatus>().notNull().default('queued'),
    blockedReason: text('blocked_reason'),
    /** Machine-readable cause for `blockedReason`; clients must not parse the text. */
    blockedCode: text('blocked_code').$type<ChannelJobBlockCode>(),

    // Execution, set when the job is claimed
    /** Actual claim time under the Channel lock; delayed routing can invert request order. */
    claimedAt: timestamptz('claimed_at'),
    /** Source-side link to the ordinary Agent conversation. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    /** Canonical execution reserved at claim time; NULL while the job waits. */
    operationId: text('operation_id')
      .unique()
      .references((): AnyPgColumn => agentOperations.id, { onDelete: 'set null' }),
    /** Where the run's input ends, frozen at claim; later messages belong to the next job. */
    manifest: jsonb('manifest').$type<ChannelInputManifest>(),
    /** Effective Agent settings and Channel environment frozen at claim time. */
    executionConfig: jsonb('execution_config').$type<ChannelExecutionConfig>(),
    /** Device of a device-hosted run; with `workingDirectory` it forms the directory lock. */
    deviceId: varchar('device_id', { length: 64 }),
    /** Canonical working directory acknowledged by the device. */
    workingDirectory: text('working_directory'),
    /** When the runtime confirmed it took the input. An unknown delivery never gets one. */
    acceptedAt: timestamptz('accepted_at'),
    /** Process (or queue worker) currently driving the run. */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    /**
     * Set when the job is claimed. Cleared only by physical stop confirmation (process tree
     * ended, or the native operation finished) or a trusted failure before dispatch, when
     * nothing ran. Leases, idleness, interrupts and operation completion do not clear it.
     */
    writerHeld: boolean('writer_held').notNull().default(false),
    /**
     * Set when termination could not be confirmed in time (INC-049). Publication is revoked so
     * the member may run again, though not in the same device directory until the stop is
     * confirmed: isolation frees the member lock but never `writerHeld`.
     */
    isolatedAt: timestamptz('isolated_at'),
    /** Final answer saved by the run; immutable once set. */
    draft: text('draft'),
    /** A revoked job never publishes. Set by stops, failures and isolation. */
    publicationRevoked: boolean('publication_revoked').notNull().default(false),
    publishedMessageId: uuid('published_message_id'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('channel_jobs_scope_unique').on(t.channelId, t.id),
    uniqueIndex('channel_jobs_delivery_unique').on(t.messageId, t.memberId),
    index('channel_jobs_channel_status_idx').on(t.channelId, t.status),
    index('channel_jobs_continuation_idx').on(
      t.memberId,
      t.requesterMemberId,
      t.threadId,
      t.claimedAt,
    ),
    index('channel_jobs_topic_idx').on(t.topicId, t.publishedMessageId),
    index('channel_jobs_member_queue_idx').on(t.memberId, t.status, t.createdAt),
    index('channel_jobs_lease_expires_idx')
      .on(t.leaseExpiresAt)
      .where(sql`${t.writerHeld} AND ${t.isolatedAt} IS NULL`),
    /** At most one writer per member. */
    uniqueIndex('channel_jobs_active_member_unique')
      .on(t.memberId)
      .where(sql`${t.writerHeld} AND ${t.isolatedAt} IS NULL`),
    /**
     * At most one writer per device directory, across all channels. Unlike the member lock,
     * isolation does not release it: only physical stop confirmation proves the old process
     * has left the directory.
     */
    uniqueIndex('channel_jobs_active_directory_unique')
      .on(t.deviceId, t.workingDirectory)
      .where(
        sql`${t.deviceId} IS NOT NULL AND ${t.workingDirectory} IS NOT NULL AND ${t.writerHeld}`,
      ),
    foreignKey({
      columns: [t.channelId, t.memberId],
      foreignColumns: [channelMembers.channelId, channelMembers.id],
      name: 'channel_jobs_member_fk',
    }),
    foreignKey({
      columns: [t.channelId, t.requesterMemberId],
      foreignColumns: [channelMembers.channelId, channelMembers.id],
      name: 'channel_jobs_requester_fk',
    }),
    foreignKey({
      columns: [t.channelId, t.messageId],
      foreignColumns: [channelMessages.channelId, channelMessages.id],
      name: 'channel_jobs_message_fk',
    }),
    foreignKey({
      columns: [t.channelId, t.threadId],
      foreignColumns: [channelThreads.channelId, channelThreads.id],
      name: 'channel_jobs_thread_fk',
    }),
  ],
);

export type ChannelItem = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type ChannelMemberItem = typeof channelMembers.$inferSelect;
export type NewChannelMember = typeof channelMembers.$inferInsert;
export type ChannelMemberGrantItem = typeof channelMemberGrants.$inferSelect;
export type ChannelThreadItem = typeof channelThreads.$inferSelect;
export type ChannelMessageItem = typeof channelMessages.$inferSelect;
export type NewChannelMessage = typeof channelMessages.$inferInsert;
export type ChannelJobItem = typeof channelJobs.$inferSelect;
