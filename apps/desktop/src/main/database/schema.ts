import { DESKTOP_PROJECTION_CACHE_TABLES } from '@lobechat/electron-client-ipc';
import { PROJECTION_FRAGMENT_NAMES, PROJECTION_SOURCES } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteColumnBuilderBase } from 'drizzle-orm/sqlite-core';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const PROJECTION_CACHE_SCHEMA_VERSION = 1;

const PROJECTION_CACHE_SCHEMA_VERSION_SQL = sql.raw(String(PROJECTION_CACHE_SCHEMA_VERSION));
const PROJECTION_SOURCE_VALUES_SQL = sql.raw(
  PROJECTION_SOURCES.map((source) => `'${source}'`).join(', '),
);

const projectionSource = (name: string) => text(name, { enum: PROJECTION_SOURCES });

const fragmentChecks = (
  constraintPrefix: string,
  data: AnySQLiteColumn,
  observedAt: AnySQLiteColumn,
  source: AnySQLiteColumn,
) => [
  check(
    `${constraintPrefix}_complete`,
    sql`((${data} IS NULL) = (${observedAt} IS NULL)) AND ((${data} IS NULL) = (${source} IS NULL))`,
  ),
  check(`${constraintPrefix}_data_json`, sql`${data} IS NULL OR json_valid(${data})`),
  check(
    `${constraintPrefix}_observed_at_positive`,
    sql`${observedAt} IS NULL OR ${observedAt} >= 0`,
  ),
  check(
    `${constraintPrefix}_source_valid`,
    sql`${source} IS NULL OR ${source} IN (${PROJECTION_SOURCE_VALUES_SQL})`,
  ),
];

const entityChecks = (
  constraintPrefix: string,
  schemaVersion: AnySQLiteColumn,
  tombstoneAt: AnySQLiteColumn,
) => [
  check(
    `${constraintPrefix}_schema_version_current`,
    sql`${schemaVersion} = ${PROJECTION_CACHE_SCHEMA_VERSION_SQL}`,
  ),
  check(
    `${constraintPrefix}_tombstone_at_positive`,
    sql`${tombstoneAt} IS NULL OR ${tombstoneAt} >= 0`,
  ),
];

const toSnakeCase = (value: string): string =>
  value.replaceAll(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase();

type FragmentColumnBuilders<FragmentName extends string> = Record<
  `${FragmentName}Data`,
  ReturnType<typeof text>
> &
  Record<`${FragmentName}ObservedAt`, ReturnType<typeof integer>> &
  Record<`${FragmentName}Source`, ReturnType<typeof projectionSource>>;

const createFragmentColumns = <const FragmentNames extends readonly string[]>(
  fragmentNames: FragmentNames,
): FragmentColumnBuilders<FragmentNames[number]> => {
  const columns: Record<string, SQLiteColumnBuilderBase> = {};

  for (const fragmentName of fragmentNames) {
    const columnPrefix = toSnakeCase(fragmentName);
    columns[`${fragmentName}Data`] = text(`${columnPrefix}_data`);
    columns[`${fragmentName}ObservedAt`] = integer(`${columnPrefix}_observed_at`);
    columns[`${fragmentName}Source`] = projectionSource(`${columnPrefix}_source`);
  }

  return columns as FragmentColumnBuilders<FragmentNames[number]>;
};

const createProjectionEntityTable = <
  TableName extends string,
  const FragmentNames extends readonly string[],
>(
  tableName: TableName,
  fragmentNames: FragmentNames,
) =>
  sqliteTable(
    tableName,
    {
      ...createFragmentColumns(fragmentNames),
      entityId: text('entity_id').notNull(),
      schemaVersion: integer('schema_version').default(PROJECTION_CACHE_SCHEMA_VERSION).notNull(),
      scope: text('scope').notNull(),
      storageId: text('storage_id').primaryKey().notNull(),
      tombstoneAt: integer('tombstone_at'),
    },
    (table) => {
      const columns = table as typeof table & Record<string, AnySQLiteColumn>;
      return [
        uniqueIndex(`${tableName}_scope_entity_unique`).on(table.scope, table.entityId),
        index(`${tableName}_scope_idx`).on(table.scope),
        ...entityChecks(tableName, table.schemaVersion, table.tombstoneAt),
        ...fragmentNames.flatMap((fragmentName) => {
          const constraintPrefix = `${tableName}_${toSnakeCase(fragmentName)}`;
          return fragmentChecks(
            constraintPrefix,
            columns[`${fragmentName}Data`],
            columns[`${fragmentName}ObservedAt`],
            columns[`${fragmentName}Source`],
          );
        }),
      ];
    },
  );

export const localRecords = sqliteTable('local_records', {
  id: text('id').primaryKey().notNull(),
  value: text('value').notNull(),
});

export const projectionAgents = createProjectionEntityTable(
  DESKTOP_PROJECTION_CACHE_TABLES.agent,
  PROJECTION_FRAGMENT_NAMES.agent,
);
export const projectionBriefs = createProjectionEntityTable(
  DESKTOP_PROJECTION_CACHE_TABLES.brief,
  PROJECTION_FRAGMENT_NAMES.brief,
);
export const projectionChatGroups = createProjectionEntityTable(
  DESKTOP_PROJECTION_CACHE_TABLES.chatGroup,
  PROJECTION_FRAGMENT_NAMES.chatGroup,
);
export const projectionTasks = createProjectionEntityTable(
  DESKTOP_PROJECTION_CACHE_TABLES.task,
  PROJECTION_FRAGMENT_NAMES.task,
);
export const projectionTopics = createProjectionEntityTable(
  DESKTOP_PROJECTION_CACHE_TABLES.topic,
  PROJECTION_FRAGMENT_NAMES.topic,
);

const createProjectionValueTable = <TableName extends string>(tableName: TableName) =>
  sqliteTable(
    tableName,
    {
      data: text('data').notNull(),
      key: text('key').notNull(),
      observedAt: integer('observed_at').notNull(),
      schemaVersion: integer('schema_version').default(PROJECTION_CACHE_SCHEMA_VERSION).notNull(),
      scope: text('scope').notNull(),
      source: projectionSource('source').notNull(),
      storageId: text('storage_id').primaryKey().notNull(),
    },
    (table) => [
      uniqueIndex(`${tableName}_scope_key_unique`).on(table.scope, table.key),
      index(`${tableName}_scope_idx`).on(table.scope),
      check(`${tableName}_data_json`, sql`json_valid(${table.data})`),
      check(`${tableName}_key_not_empty`, sql`length(${table.key}) > 0`),
      check(`${tableName}_observed_at_positive`, sql`${table.observedAt} >= 0`),
      check(
        `${tableName}_schema_version_current`,
        sql`${table.schemaVersion} = ${PROJECTION_CACHE_SCHEMA_VERSION_SQL}`,
      ),
      check(`${tableName}_source_valid`, sql`${table.source} IN (${PROJECTION_SOURCE_VALUES_SQL})`),
    ],
  );

export const projectionIndexes = createProjectionValueTable(
  DESKTOP_PROJECTION_CACHE_TABLES.indexes,
);
export const projectionSnapshots = createProjectionValueTable(
  DESKTOP_PROJECTION_CACHE_TABLES.snapshots,
);

export const localDatabaseSchema = {
  localRecords,
  projectionAgents,
  projectionBriefs,
  projectionChatGroups,
  projectionIndexes,
  projectionSnapshots,
  projectionTasks,
  projectionTopics,
};
