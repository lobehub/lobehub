import type {
  EnvironmentConfiguration,
  EnvironmentInstanceConfiguration,
  EnvironmentInstanceKind,
  EnvironmentInstanceStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { devices } from './device';
import { environments } from './environment';

/** A concrete materialization of an abstract environment, independent of any project or agent. */
export const environmentInstances = pgTable(
  'environment_instances',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    environmentId: uuid('environment_id')
      .references(() => environments.id, { onDelete: 'restrict' })
      .notNull(),
    /** Ownership and access scope are inherited from the environment; device access is checked separately. */
    name: varchar('name', { length: 255 }).notNull(),
    kind: text('kind').$type<EnvironmentInstanceKind>().notNull(),
    /** Internal devices.id, including remote machines enrolled through lh connect. */
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'restrict' }),
    /** Sandbox adapter identifier, or rc for a cluster binding. */
    provider: text('provider'),
    /** Non-secret provider account/cluster scope; external IDs are unique only within this scope. */
    providerScope: text('provider_scope'),
    /** Sandbox or rc-controlled resource reference; never an access token or a signed URL. */
    providerResourceId: text('provider_resource_id'),
    /** Physical working path in this instance, not a repository URL. */
    workingDirectory: text('working_directory').notNull(),
    /** Definition snapshot used to materialize this instance; not implicitly refreshed. */
    configurationSnapshot: jsonb('configuration_snapshot')
      .$type<EnvironmentConfiguration>()
      .notNull(),
    configuration: jsonb('configuration').$type<EnvironmentInstanceConfiguration>(),
    enabled: boolean('enabled').notNull().default(true),
    /** Last recorded instance state; ready is not proof that a device is currently online. */
    status: text('status').$type<EnvironmentInstanceStatus>().notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('environment_instances_environment_id_id_unique').on(t.environmentId, t.id),
    uniqueIndex('environment_instances_device_path_unique')
      .on(t.deviceId, t.workingDirectory)
      .where(sql`${t.deviceId} IS NOT NULL`),
    uniqueIndex('environment_instances_provider_path_unique')
      .on(t.kind, t.provider, t.providerScope, t.providerResourceId, t.workingDirectory)
      .where(sql`${t.deviceId} IS NULL`),
    index('environment_instances_environment_id_idx').on(t.environmentId),
    check('environment_instances_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check(
      'environment_instances_directory_not_empty',
      sql`length(btrim(${t.workingDirectory})) > 0`,
    ),
    check(
      'environment_instances_snapshot_object',
      sql`jsonb_typeof(${t.configurationSnapshot}) = 'object'`,
    ),
    check(
      'environment_instances_configuration_object',
      sql`${t.configuration} IS NULL OR jsonb_typeof(${t.configuration}) = 'object'`,
    ),
    check(
      'environment_instances_binding',
      sql`(
    ${t.kind} = 'device' AND ${t.deviceId} IS NOT NULL AND ${t.provider} IS NULL AND ${t.providerScope} IS NULL AND ${t.providerResourceId} IS NULL
  ) OR (
    ${t.kind} <> 'device' AND ${t.deviceId} IS NULL AND
    ${t.provider} IS NOT NULL AND length(btrim(${t.provider})) > 0 AND
    ${t.providerScope} IS NOT NULL AND length(btrim(${t.providerScope})) > 0 AND
    ${t.providerResourceId} IS NOT NULL AND length(btrim(${t.providerResourceId})) > 0
  )`,
    ),
  ],
);

export type NewEnvironmentInstance = typeof environmentInstances.$inferInsert;
export type EnvironmentInstanceItem = typeof environmentInstances.$inferSelect;
