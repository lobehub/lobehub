import type {
  ContactMetadata,
  ContactRequestSource,
  ContactRequestStatus,
  ContactType,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * One entry in an address book. Every entry belongs to the scope it was made in.
 *
 * A `user` entry pins `user_id`. Without `workspace_id` it is a personal contact, listed only in
 * the personal space. With one it pairs a member of that workspace with an external contact: a
 * person outside it who accepted a member's invitation. Colleagues need no entry, they are the
 * workspace's members; an external contact sees only the members paired with them there, the
 * inviter first, and each member opens or closes only themselves.
 *
 * An `agent` entry with no `workspace_id` is its owner's alone; with one it is the workspace's,
 * shown to every member there, and `user_id` only records who added it.
 *
 * A `user` entry exists only for an accepted contact request or a member opening themselves to
 * an external contact, and always in both directions.
 * An `agent` entry is another person's Agent added through its share link. It references the
 * Agent, not the share: an Agent has at most one share row, and access is rechecked against
 * that live row on every read and run, so pausing the share disables the entry without
 * deleting it. The application keeps the row shape (`contact_user_id` for `user`, `agent_id`
 * for `agent`) and never adds yourself.
 *
 * Remark, note, phone numbers and metadata belong to the address book's owner: they describe the
 * entry for them alone and are never shown to the other person. Grouping is in
 * `user_contact_tags`, shared across the whole address book.
 */
export const userContacts = pgTable(
  'user_contacts',
  {
    // Only ever addressed through the contact's own id, so no id prefix.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** The workspace whose address book holds the entry; null is personal. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    type: text('type').$type<ContactType>().notNull(),
    contactUserId: text('contact_user_id').references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    // The owner's own notes about this entry; never shown to the other person.
    /** Remark name shown instead of the contact's own name. */
    remark: text('remark'),
    /** Free-form note. */
    description: text('description'),
    phones: text('phones').array(),
    metadata: jsonb('metadata').$type<ContactMetadata>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contacts_user_unique')
      .on(t.userId, t.contactUserId)
      .where(sql`${t.contactUserId} IS NOT NULL AND ${t.workspaceId} IS NULL`),
    uniqueIndex('user_contacts_workspace_user_unique')
      .on(t.workspaceId, t.userId, t.contactUserId)
      .where(sql`${t.contactUserId} IS NOT NULL AND ${t.workspaceId} IS NOT NULL`),
    uniqueIndex('user_contacts_agent_unique')
      .on(t.userId, t.agentId)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.workspaceId} IS NULL`),
    uniqueIndex('user_contacts_workspace_agent_unique')
      .on(t.workspaceId, t.agentId)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.workspaceId} IS NOT NULL`),
    // Neither partial index serves the cascades from users and agents.
    index('user_contacts_contact_user_id_idx').on(t.contactUserId),
    index('user_contacts_agent_id_idx').on(t.agentId),
    index('user_contacts_workspace_id_idx').on(t.workspaceId),
  ],
);

/**
 * A request to become mutual contacts. At most one pending request exists per ordered pair and
 * scope; a personal request sent while the other person's is pending accepts it instead. Answered
 * rows are kept for their status, and a new request may follow a declined or cancelled one.
 *
 * With `workspace_id` it is a member inviting someone outside the workspace to be its external
 * contact. The addressee answers it from their personal space, since they cannot enter the
 * workspace before accepting.
 */
export const userContactRequests = pgTable(
  'user_contact_requests',
  {
    // Accepted, declined or cancelled by id.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    requesterId: text('requester_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    addresseeId: text('addressee_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** The workspace a member sent it from, for an external contact; null is personal. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    message: text('message'),
    /** How the requester found the addressee, e.g. a card someone shared; null otherwise. */
    source: jsonb('source').$type<ContactRequestSource>(),
    status: text('status').$type<ContactRequestStatus>().notNull().default('pending'),
    respondedAt: timestamptz('responded_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contact_requests_pending_unique')
      .on(t.requesterId, t.addresseeId)
      .where(sql`${t.status} = 'pending' AND ${t.workspaceId} IS NULL`),
    uniqueIndex('user_contact_requests_workspace_pending_unique')
      .on(t.workspaceId, t.requesterId, t.addresseeId)
      .where(sql`${t.status} = 'pending' AND ${t.workspaceId} IS NOT NULL`),
    index('user_contact_requests_addressee_status_idx').on(t.addresseeId, t.status),
    index('user_contact_requests_requester_status_idx').on(t.requesterId, t.status),
    index('user_contact_requests_workspace_id_idx').on(t.workspaceId),
    check('user_contact_requests_not_self_check', sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

export type UserContactItem = typeof userContacts.$inferSelect;
export type NewUserContact = typeof userContacts.$inferInsert;
export type UserContactRequestItem = typeof userContactRequests.$inferSelect;

/**
 * A tag of a person's address book: one global grouping, applied to any number of entries
 * through `user_contact_tag_assignments`. Personal, like the address book.
 */
export const userContactTags = pgTable(
  'user_contact_tags',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    name: text('name').notNull(),
    /** Display color as a CSS hex value, e.g. `#F5A623`. */
    color: text('color'),
    /** Position in the tag list, ascending. */
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  // Names are what tells two tags apart, so they are unique per address book.
  (t) => [uniqueIndex('user_contact_tags_user_id_name_unique').on(t.userId, t.name)],
);

/** An address book entry carrying a tag; an entry can carry any number of them. */
export const userContactTagAssignments = pgTable(
  'user_contact_tag_assignments',
  {
    // Only ever read in bulk for a tag or an entry.
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    tagId: uuid('tag_id')
      .references(() => userContactTags.id, { onDelete: 'cascade' })
      .notNull(),
    contactId: uuid('contact_id')
      .references(() => userContacts.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contact_tag_assignments_tag_id_contact_id_unique').on(t.tagId, t.contactId),
    index('user_contact_tag_assignments_contact_id_idx').on(t.contactId),
    index('user_contact_tag_assignments_user_id_idx').on(t.userId),
  ],
);

export type UserContactTagItem = typeof userContactTags.$inferSelect;
export type NewUserContactTag = typeof userContactTags.$inferInsert;
export type UserContactTagAssignmentItem = typeof userContactTagAssignments.$inferSelect;
