import type { EmojiPackKind, EmojiPackScope, EmojiPackVisibility } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz } from './_helpers';
import { globalFiles } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A set of custom emojis, the unit people add, share and order (as in WeChat and Telegram).
 * Each person's loose saved emojis live in their one implicit `favorites` pack.
 *
 * Packs are never hard-deleted while messages may reference their emojis: `removed_at` hides
 * them from pickers, but tokens in history still resolve to an image.
 */
export const emojiPacks = pgTable(
  'emoji_packs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('emojiPacks'))
      .notNull(),
    scope: text('scope').$type<EmojiPackScope>().notNull(),
    /** Owner of a `user` pack. NULL on `workspace` packs. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Owner of a `workspace` pack. NULL on `user` packs. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<EmojiPackKind>().notNull(),
    title: text('title').notNull(),
    /** Hidden from pickers; emojis in it still render in existing messages. */
    removedAt: timestamptz('removed_at'),
    visibility: text('visibility').$type<EmojiPackVisibility>().notNull().default('private'),
    ...timestamps,
  },
  (t) => [
    index('emoji_packs_user_id_idx').on(t.userId),
    index('emoji_packs_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('emoji_packs_user_favorites_unique')
      .on(t.userId)
      .where(sql`${t.kind} = 'favorites' AND ${t.removedAt} IS NULL`),
    // One constraint per rule, so a new scope or kind adds constraints instead of rewriting these.
    check(
      'emoji_packs_user_shape_check',
      sql`${t.scope} <> 'user' OR (${t.userId} IS NOT NULL AND ${t.workspaceId} IS NULL)`,
    ),
    check(
      'emoji_packs_workspace_shape_check',
      sql`${t.scope} <> 'workspace' OR (${t.workspaceId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
    check(
      'emoji_packs_favorites_owner_check',
      sql`${t.kind} <> 'favorites' OR ${t.scope} = 'user'`,
    ),
  ],
);

/**
 * One custom emoji. Messages reference it as the token `<:name:emj_xxx>`: alone in a message it
 * renders as a sticker, inside text as an inline image, and unresolved as `:name:`.
 */
export const customEmojis = pgTable(
  'custom_emojis',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('customEmojis'))
      .notNull(),
    packId: text('pack_id')
      .references(() => emojiPacks.id, { onDelete: 'cascade' })
      .notNull(),
    /** Uploader. Cleared when the account is deleted, so workspace emojis outlive them. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The image, by content hash. It points at the shared blob rather than a `files` row: those
     * belong to one person and go with their account, while a workspace emoji outlives its
     * uploader. File cleanup keeps any blob an emoji still references; `restrict` backs that up.
     */
    fileHash: varchar('file_hash', { length: 64 })
      .references(() => globalFiles.hashId, { onDelete: 'restrict' })
      .notNull(),
    /** Shortcode without colons, e.g. `doge` for `:doge:`. Unique among live emojis in a pack. */
    name: text('name').notNull(),
    /** Extra search terms for the picker and `:` suggestions. */
    keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
    /** Unicode emojis that suggest this one while typed, e.g. `['😂']` (as in Telegram). */
    boundEmojis: jsonb('bound_emojis').$type<string[]>().notNull().default([]),
    animated: boolean('animated').notNull().default(false),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Hidden from pickers; existing message tokens still resolve. */
    removedAt: timestamptz('removed_at'),
    ...timestamps,
  },
  (t) => [
    index('custom_emojis_pack_id_sort_order_idx').on(t.packId, t.sortOrder),
    index('custom_emojis_file_hash_idx').on(t.fileHash),
    uniqueIndex('custom_emojis_pack_id_name_unique')
      .on(t.packId, t.name)
      .where(sql`${t.removedAt} IS NULL`),
  ],
);

/** The packs in one person's picker, in their order. Owning a pack does not add it implicitly. */
export const userEmojiPacks = pgTable(
  'user_emoji_packs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    packId: text('pack_id')
      .references(() => emojiPacks.id, { onDelete: 'cascade' })
      .notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_emoji_packs_user_id_pack_id_unique').on(t.userId, t.packId),
    index('user_emoji_packs_pack_id_idx').on(t.packId),
  ],
);

export type EmojiPackItem = typeof emojiPacks.$inferSelect;
export type NewEmojiPack = typeof emojiPacks.$inferInsert;
export type CustomEmojiItem = typeof customEmojis.$inferSelect;
export type NewCustomEmoji = typeof customEmojis.$inferInsert;
