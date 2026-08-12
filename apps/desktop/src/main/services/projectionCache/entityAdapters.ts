import type {
  DesktopProjectionCacheTable,
  DesktopProjectionFragment,
  DesktopProjectionKind,
  DesktopProjectionRecord,
} from '@lobechat/electron-client-ipc';
import { DESKTOP_PROJECTION_CACHE_TABLES } from '@lobechat/electron-client-ipc';
import type { ProjectionFragmentName, ProjectionKind } from '@lobechat/types';
import {
  isProjectionSource,
  isProjectionTimestamp,
  PROJECTION_FRAGMENT_NAMES,
} from '@lobechat/types';
import { inArray, or, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  PROJECTION_CACHE_SCHEMA_VERSION,
  projectionAgents,
  projectionBriefs,
  projectionChatGroups,
  projectionTasks,
  projectionTopics,
} from '@/database/schema';

export type ProjectionEntityTable = AnySQLiteTable & {
  entityId: AnySQLiteColumn;
  schemaVersion: AnySQLiteColumn;
  scope: AnySQLiteColumn;
  storageId: AnySQLiteColumn;
  tombstoneAt: AnySQLiteColumn;
};

type ProjectionEntityRow = Record<string, unknown> & {
  entityId: string;
  tombstoneAt: number | null;
};

export interface ProjectionEntityAdapter {
  collection: DesktopProjectionCacheTable;
  fragments: readonly string[];
  kind: DesktopProjectionKind;
  matchIds?: (ids: string[]) => SQL | undefined;
  read: (row: ProjectionEntityRow) => DesktopProjectionRecord;
  table: ProjectionEntityTable;
  values: (scope: string, record: DesktopProjectionRecord) => Record<string, unknown>;
}

const fragmentValues = (fragment: DesktopProjectionFragment | undefined) => ({
  data: fragment?.data ?? null,
  observedAt: fragment?.observedAt ?? null,
  source: fragment?.source ?? null,
});

export const projectionStorageId = (scope: string, identity: string): string =>
  `${encodeURIComponent(scope)}::${encodeURIComponent(identity)}`;

const createProjectionEntityAdapter = <Kind extends ProjectionKind>({
  collection,
  fragments,
  kind,
  matchIds,
  table,
}: {
  collection: DesktopProjectionCacheTable;
  fragments: readonly ProjectionFragmentName<Kind>[];
  kind: Kind;
  matchIds?: (ids: string[]) => SQL | undefined;
  table: ProjectionEntityTable;
}): ProjectionEntityAdapter => ({
  collection,
  fragments,
  kind,
  matchIds,
  read: (row) => {
    const recordFragments: Record<string, DesktopProjectionFragment> = {};
    for (const fragmentName of fragments) {
      const data = row[`${fragmentName}Data`];
      const observedAt = row[`${fragmentName}ObservedAt`];
      const source = row[`${fragmentName}Source`];
      if (
        typeof data !== 'string' ||
        !isProjectionTimestamp(observedAt) ||
        !isProjectionSource(source)
      ) {
        continue;
      }
      recordFragments[fragmentName] = { data, observedAt, source };
    }

    return {
      fragments: recordFragments,
      id: row.entityId,
      kind,
      ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
    } as DesktopProjectionRecord;
  },
  table,
  values: (scope, record) => {
    const values: Record<string, unknown> = {
      entityId: record.id,
      schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
      scope,
      storageId: projectionStorageId(scope, record.id),
      tombstoneAt: record.tombstoneAt ?? null,
    };
    const recordFragments = record.fragments as Record<
      string,
      DesktopProjectionFragment | undefined
    >;
    for (const fragmentName of fragments) {
      const fragment = fragmentValues(recordFragments[fragmentName]);
      values[`${fragmentName}Data`] = fragment.data;
      values[`${fragmentName}ObservedAt`] = fragment.observedAt;
      values[`${fragmentName}Source`] = fragment.source;
    }
    return values;
  },
});

export const PROJECTION_ENTITY_ADAPTERS = {
  agent: createProjectionEntityAdapter({
    collection: DESKTOP_PROJECTION_CACHE_TABLES.agent,
    fragments: PROJECTION_FRAGMENT_NAMES.agent,
    kind: 'agent',
    table: projectionAgents,
  }),
  brief: createProjectionEntityAdapter({
    collection: DESKTOP_PROJECTION_CACHE_TABLES.brief,
    fragments: PROJECTION_FRAGMENT_NAMES.brief,
    kind: 'brief',
    table: projectionBriefs,
  }),
  chatGroup: createProjectionEntityAdapter({
    collection: DESKTOP_PROJECTION_CACHE_TABLES.chatGroup,
    fragments: PROJECTION_FRAGMENT_NAMES.chatGroup,
    kind: 'chatGroup',
    table: projectionChatGroups,
  }),
  task: createProjectionEntityAdapter({
    collection: DESKTOP_PROJECTION_CACHE_TABLES.task,
    fragments: PROJECTION_FRAGMENT_NAMES.task,
    kind: 'task',
    matchIds: (ids) =>
      or(
        inArray(projectionTasks.entityId, ids),
        inArray(
          sql<string>`json_extract(${projectionTasks.identityData}, '$.json.identifier')`,
          ids,
        ),
      ),
    table: projectionTasks,
  }),
  topic: createProjectionEntityAdapter({
    collection: DESKTOP_PROJECTION_CACHE_TABLES.topic,
    fragments: PROJECTION_FRAGMENT_NAMES.topic,
    kind: 'topic',
    table: projectionTopics,
  }),
} as const satisfies Record<ProjectionKind, ProjectionEntityAdapter>;

export const PROJECTION_ENTITY_ADAPTER_LIST = Object.values(PROJECTION_ENTITY_ADAPTERS);
