import type { WorkingDirEntry } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Stable device identity anchor — one row per physical machine per user.
 *
 * `deviceId` is derived from a machine-level identifier
 * (`sha256(machineUUID + userId + salt)`), so it survives LobeHub reinstalls
 * and desktop upgrades. Online status is NOT stored here — it lives in the
 * DeviceGatewayDO in-memory WS attachments; this table only records "ever
 * seen" so offline devices stay visible and bindable.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // `workspace_id` distinguishes the two kinds of device row:
    //   - NULL          → a PERSONAL device, identified by (userId, deviceId).
    //   - <workspaceId> → a device ENROLLED into that workspace (shared infra),
    //     identified by (workspaceId, deviceId). `userId` then only records the
    //     enrolling admin — it is NOT part of the identity, so two admins
    //     enrolling the same machine resolve to ONE row (see the partial unique
    //     below). The same physical machine produces a distinct `deviceId` per
    //     principal (the hash mixes in userId / `workspace:<id>`), so personal
    //     and workspace rows never collide.
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Machine-derived id (sha256 truncated to 32 chars; 64 leaves room for fallback randomUUID) */
    deviceId: varchar('device_id', { length: 64 }).notNull(),
    /** 'machine-id' | 'fallback' — validated by zod at the router boundary */
    identitySource: varchar('identity_source', { length: 20 }).notNull(),

    hostname: text('hostname'),
    /** 'darwin' | 'win32' | 'linux' */
    platform: varchar('platform', { length: 20 }),
    /** User-editable alias */
    friendlyName: text('friendly_name'),

    defaultCwd: text('default_cwd'),
    /** @deprecated superseded by `workingDirs` (structured). Kept as a legacy column; no longer read/written. */
    recentCwds: text('recent_cwds').array().default([]).notNull(),
    workingDirs: jsonb('working_dirs').$type<WorkingDirEntry[]>().default([]),

    firstSeenAt: timestamptz('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamptz('last_seen_at').defaultNow().notNull(),

    ...timestamps,
  },
  (t) => [
    /**
     * One row per (user, machine) for PERSONAL devices; register() upserts on
     * this target (partial → ON CONFLICT must repeat the
     * `WHERE workspace_id IS NULL` predicate). Workspace rows are excluded so
     * `user_id` is not part of their identity (see workspace partial below).
     */
    uniqueIndex('devices_user_id_device_id_unique')
      .on(t.userId, t.deviceId)
      .where(sql`${t.workspaceId} IS NULL`),
    /**
     * One row per (workspace, machine) for enrolled devices, regardless of which
     * admin ran the enrollment. registerWorkspaceDevice() upserts on this target
     * (partial → ON CONFLICT must repeat the `WHERE workspace_id IS NOT NULL`
     * predicate).
     */
    uniqueIndex('devices_workspace_id_device_id_unique')
      .on(t.workspaceId, t.deviceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('devices_user_id_idx').on(t.userId),
    index('devices_workspace_id_idx').on(t.workspaceId),
  ],
);

export type DeviceItem = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
