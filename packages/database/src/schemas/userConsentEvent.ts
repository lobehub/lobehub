import type {
  ConsentEventClient,
  ConsentEventKind,
  ConsentEventResourceType,
  ConsentEventSource,
  ConsentNotice,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';

/**
 * Append-only evidence of a person's own authorization decisions: who decided, when, from which
 * client and IP, after which notice, and the authorization before and after (see
 * `ConsentEventKind`). Written in the same transaction as the change it records, so a change
 * never commits without its evidence and evidence never claims a change that rolled back.
 *
 * Deliberately no foreign keys: evidence must outlive the user, Workspace, Agent or share it
 * names, and no cascade may decide when it is erased. There is no `updatedAt`; rows are never
 * edited.
 */
export const userConsentEvents = pgTable(
  'user_consent_events',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** The person who made the decision; may differ from the resource's owner (a Workspace admin). */
    actorUserId: text('actor_user_id').notNull(),
    /** The Workspace that owns the resource, or `null` for a personal one. */
    workspaceId: text('workspace_id'),

    kind: text('kind').$type<ConsentEventKind>().notNull(),
    source: text('source').$type<ConsentEventSource>().notNull(),
    resourceType: text('resource_type').$type<ConsentEventResourceType>(),
    resourceId: text('resource_id'),

    /** The authorization this kind covers before the decision; `null` when there was none. */
    before: jsonb('before'),
    /** The authorization this kind covers after the decision; `null` when it was removed. */
    after: jsonb('after'),
    notice: jsonb('notice').$type<ConsentNotice>(),

    /** Visitor IP resolved by the server (`getClientIP`), never a client-supplied value. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    client: jsonb('client').$type<ConsentEventClient>(),

    createdAt: createdAt(),
  },
  (t) => [
    index('user_consent_events_resource_created_at_idx').on(
      t.resourceType,
      t.resourceId,
      t.createdAt,
    ),
    index('user_consent_events_actor_created_at_idx').on(t.actorUserId, t.createdAt),
    index('user_consent_events_workspace_created_at_idx')
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);
