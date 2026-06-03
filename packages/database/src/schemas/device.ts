import { index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * A working directory the device has used. Structured (rather than a bare path
 * string) so metadata such as the detected repo type survives — a remote client
 * viewing this device can't re-probe its filesystem, so whatever isn't captured
 * here at the source is lost. Mirrors the client-local `RecentDirEntry` shape.
 */
export interface WorkingDirEntry {
  path: string;
  repoType?: 'git' | 'github';
}

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
    workspaceId: text('workspace_id'),

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
    /** One row per (user, machine); register() upserts on this target */
    uniqueIndex('devices_user_id_device_id_unique').on(t.userId, t.deviceId),
    index('devices_user_id_idx').on(t.userId),
  ],
);

export type DeviceItem = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
