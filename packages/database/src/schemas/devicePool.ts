import type { DevicePoolMatrix, DevicePoolPolicy } from '@lobechat/types';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { devices } from './device';
import { users } from './user';
import { workspaces } from './workspace';

/** Device authorization collections owned by a user within an optional workspace. */
export const devicePools = pgTable(
  'device_pools',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('devicePools'))
      .primaryKey()
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Trigger rules apply to verified callers independently of the pool creator. */
    policy: jsonb('policy').$type<DevicePoolPolicy>().notNull(),
    ...timestamps,
  },
  (t) => [index('device_pools_scope_idx').on(t.workspaceId, t.userId)],
);

/** Owner-authorized membership of a registered device in a pool. */
export const devicePoolDevices = pgTable(
  'device_pool_devices',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    poolId: text('pool_id')
      .references(() => devicePools.id, { onDelete: 'cascade' })
      .notNull(),
    /** Registry primary key, not the gateway's machine identifier. */
    deviceId: uuid('device_id')
      .references(() => devices.id, { onDelete: 'cascade' })
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('device_pool_devices_pool_device_unique').on(t.poolId, t.deviceId),
    index('device_pool_devices_device_idx').on(t.deviceId),
  ],
);

/** Sparse entry-specific overrides, editable by the pool policy owner. */
export const agentDevicePoolPolicies = pgTable(
  'agent_device_pool_policies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    poolId: text('pool_id')
      .references(() => devicePools.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    rules: jsonb('rules').$type<DevicePoolMatrix>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_device_pool_policies_pool_agent_unique').on(t.poolId, t.agentId),
    index('agent_device_pool_policies_agent_idx').on(t.agentId),
  ],
);
