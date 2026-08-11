import type {
  DesktopLocalDatabaseCollectionInfo,
  DesktopLocalDatabaseEntry,
  DesktopProjectionCommit,
  DesktopProjectionFragment,
  DesktopProjectionHydration,
  DesktopProjectionIndex,
  DesktopProjectionKind,
  DesktopProjectionRecord,
  DesktopProjectionSnapshot,
  DesktopProjectionSource,
} from '@lobechat/electron-client-ipc';
import { DESKTOP_PROJECTION_CACHE_TABLES } from '@lobechat/electron-client-ipc';
import { and, asc, count, eq } from 'drizzle-orm';
import superjson from 'superjson';

import {
  PROJECTION_CACHE_SCHEMA_VERSION,
  projectionAgents,
  projectionBriefs,
  projectionChatGroups,
  projectionHomeIndexes,
  projectionHomeSnapshots,
  projectionTasks,
  projectionTopics,
} from '@/database/schema';

import { ServiceModule } from './index';
import LocalDatabaseService from './LocalDatabaseSrv';

const SOURCES = new Set<DesktopProjectionSource>(['mutation', 'network', 'realtime']);
const HOME_INDEX_KEYS = new Set([
  'home.inboxTopics',
  'home.recentTopics',
  'home.sidebar',
  'home.tasks',
  'home.unresolvedBriefs',
]);
const HOME_SNAPSHOT_KEYS = new Set(['home.dailyBrief']);
const FRAGMENTS: Record<DesktopProjectionKind, ReadonlySet<string>> = {
  agent: new Set(['access', 'identity', 'profile', 'routing', 'runtime']),
  brief: new Set(['actions', 'content', 'readState', 'relations', 'resolution']),
  chatGroup: new Set(['access', 'identity']),
  task: new Set(['assignment', 'description', 'display', 'identity', 'lifecycle']),
  topic: new Set([
    'activity',
    'creation',
    'display',
    'navigation',
    'preview',
    'routing',
    'runTiming',
    'status',
  ]),
};

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const assertSerializedData = (value: string, label: string): void => {
  try {
    JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must contain valid serialized JSON`, { cause: error });
  }
};

const assertObservation = (
  value: { data: string; observedAt: number; source: DesktopProjectionSource },
  label: string,
): void => {
  assertSerializedData(value.data, label);
  if (!isTimestamp(value.observedAt)) throw new Error(`${label}.observedAt is invalid`);
  if (!SOURCES.has(value.source)) throw new Error(`${label}.source is invalid`);
};

const assertCommit = (commit: DesktopProjectionCommit): void => {
  if (!commit.scope) throw new Error('Projection cache scope is required');

  for (const record of commit.records ?? []) {
    if (!record.id) throw new Error('Projection cache entity id is required');
    const allowedFragments = FRAGMENTS[record.kind];
    if (!allowedFragments) throw new Error(`Unsupported Projection kind: ${record.kind}`);
    if (record.tombstoneAt !== undefined && !isTimestamp(record.tombstoneAt)) {
      throw new Error(`Invalid tombstone for ${record.kind}:${record.id}`);
    }

    for (const [name, fragment] of Object.entries(record.fragments)) {
      if (!allowedFragments.has(name)) {
        throw new Error(`Unsupported ${record.kind} fragment: ${name}`);
      }
      assertObservation(fragment, `${record.kind}.${name}`);
    }
  }

  for (const index of commit.indexes ?? []) {
    if (!HOME_INDEX_KEYS.has(index.key))
      throw new Error(`Unsupported Projection index: ${index.key}`);
    assertObservation(index, index.key);
  }

  for (const snapshot of commit.snapshots ?? []) {
    if (!HOME_SNAPSHOT_KEYS.has(snapshot.key)) {
      throw new Error(`Unsupported Projection snapshot: ${snapshot.key}`);
    }
    assertObservation(snapshot, snapshot.key);
  }
};

const storageId = (scope: string, identity: string): string =>
  `${encodeURIComponent(scope)}::${encodeURIComponent(identity)}`;

const fragmentValues = (fragment: DesktopProjectionFragment | undefined) => ({
  data: fragment?.data ?? null,
  observedAt: fragment?.observedAt ?? null,
  source: fragment?.source ?? null,
});

const entityValues = (scope: string, record: DesktopProjectionRecord) => ({
  entityId: record.id,
  schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
  scope,
  storageId: storageId(scope, record.id),
  tombstoneAt: record.tombstoneAt ?? null,
});

const agentValues = (scope: string, record: DesktopProjectionRecord) => {
  const access = fragmentValues(record.fragments.access);
  const identity = fragmentValues(record.fragments.identity);
  const profile = fragmentValues(record.fragments.profile);
  const routing = fragmentValues(record.fragments.routing);
  const runtime = fragmentValues(record.fragments.runtime);

  return {
    ...entityValues(scope, record),
    accessData: access.data,
    accessObservedAt: access.observedAt,
    accessSource: access.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
    profileData: profile.data,
    profileObservedAt: profile.observedAt,
    profileSource: profile.source,
    routingData: routing.data,
    routingObservedAt: routing.observedAt,
    routingSource: routing.source,
    runtimeData: runtime.data,
    runtimeObservedAt: runtime.observedAt,
    runtimeSource: runtime.source,
  };
};

const chatGroupValues = (scope: string, record: DesktopProjectionRecord) => {
  const access = fragmentValues(record.fragments.access);
  const identity = fragmentValues(record.fragments.identity);

  return {
    ...entityValues(scope, record),
    accessData: access.data,
    accessObservedAt: access.observedAt,
    accessSource: access.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
  };
};

const topicValues = (scope: string, record: DesktopProjectionRecord) => {
  const activity = fragmentValues(record.fragments.activity);
  const creation = fragmentValues(record.fragments.creation);
  const display = fragmentValues(record.fragments.display);
  const navigation = fragmentValues(record.fragments.navigation);
  const preview = fragmentValues(record.fragments.preview);
  const routing = fragmentValues(record.fragments.routing);
  const runTiming = fragmentValues(record.fragments.runTiming);
  const status = fragmentValues(record.fragments.status);

  return {
    ...entityValues(scope, record),
    activityData: activity.data,
    activityObservedAt: activity.observedAt,
    activitySource: activity.source,
    creationData: creation.data,
    creationObservedAt: creation.observedAt,
    creationSource: creation.source,
    displayData: display.data,
    displayObservedAt: display.observedAt,
    displaySource: display.source,
    navigationData: navigation.data,
    navigationObservedAt: navigation.observedAt,
    navigationSource: navigation.source,
    previewData: preview.data,
    previewObservedAt: preview.observedAt,
    previewSource: preview.source,
    routingData: routing.data,
    routingObservedAt: routing.observedAt,
    routingSource: routing.source,
    runTimingData: runTiming.data,
    runTimingObservedAt: runTiming.observedAt,
    runTimingSource: runTiming.source,
    statusData: status.data,
    statusObservedAt: status.observedAt,
    statusSource: status.source,
  };
};

const taskValues = (scope: string, record: DesktopProjectionRecord) => {
  const assignment = fragmentValues(record.fragments.assignment);
  const description = fragmentValues(record.fragments.description);
  const display = fragmentValues(record.fragments.display);
  const identity = fragmentValues(record.fragments.identity);
  const lifecycle = fragmentValues(record.fragments.lifecycle);

  return {
    ...entityValues(scope, record),
    assignmentData: assignment.data,
    assignmentObservedAt: assignment.observedAt,
    assignmentSource: assignment.source,
    descriptionData: description.data,
    descriptionObservedAt: description.observedAt,
    descriptionSource: description.source,
    displayData: display.data,
    displayObservedAt: display.observedAt,
    displaySource: display.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
    lifecycleData: lifecycle.data,
    lifecycleObservedAt: lifecycle.observedAt,
    lifecycleSource: lifecycle.source,
  };
};

const briefValues = (scope: string, record: DesktopProjectionRecord) => {
  const actions = fragmentValues(record.fragments.actions);
  const content = fragmentValues(record.fragments.content);
  const readState = fragmentValues(record.fragments.readState);
  const relations = fragmentValues(record.fragments.relations);
  const resolution = fragmentValues(record.fragments.resolution);

  return {
    ...entityValues(scope, record),
    actionsData: actions.data,
    actionsObservedAt: actions.observedAt,
    actionsSource: actions.source,
    contentData: content.data,
    contentObservedAt: content.observedAt,
    contentSource: content.source,
    readStateData: readState.data,
    readStateObservedAt: readState.observedAt,
    readStateSource: readState.source,
    relationsData: relations.data,
    relationsObservedAt: relations.observedAt,
    relationsSource: relations.source,
    resolutionData: resolution.data,
    resolutionObservedAt: resolution.observedAt,
    resolutionSource: resolution.source,
  };
};

const readFragment = (
  data: string | null,
  observedAt: number | null,
  source: DesktopProjectionSource | null,
): DesktopProjectionFragment | undefined => {
  if (data === null || observedAt === null || source === null) return undefined;
  return { data, observedAt, source };
};

const compactFragments = (
  fragments: Array<[string, DesktopProjectionFragment | undefined]>,
): Record<string, DesktopProjectionFragment> =>
  Object.fromEntries(
    fragments.filter((entry): entry is [string, DesktopProjectionFragment] => Boolean(entry[1])),
  );

const readAgent = (row: typeof projectionAgents.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    ['access', readFragment(row.accessData, row.accessObservedAt, row.accessSource)],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
    ['profile', readFragment(row.profileData, row.profileObservedAt, row.profileSource)],
    ['routing', readFragment(row.routingData, row.routingObservedAt, row.routingSource)],
    ['runtime', readFragment(row.runtimeData, row.runtimeObservedAt, row.runtimeSource)],
  ]),
  id: row.entityId,
  kind: 'agent',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const readChatGroup = (row: typeof projectionChatGroups.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    ['access', readFragment(row.accessData, row.accessObservedAt, row.accessSource)],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
  ]),
  id: row.entityId,
  kind: 'chatGroup',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const readTopic = (row: typeof projectionTopics.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    ['activity', readFragment(row.activityData, row.activityObservedAt, row.activitySource)],
    ['creation', readFragment(row.creationData, row.creationObservedAt, row.creationSource)],
    ['display', readFragment(row.displayData, row.displayObservedAt, row.displaySource)],
    [
      'navigation',
      readFragment(row.navigationData, row.navigationObservedAt, row.navigationSource),
    ],
    ['preview', readFragment(row.previewData, row.previewObservedAt, row.previewSource)],
    ['routing', readFragment(row.routingData, row.routingObservedAt, row.routingSource)],
    ['runTiming', readFragment(row.runTimingData, row.runTimingObservedAt, row.runTimingSource)],
    ['status', readFragment(row.statusData, row.statusObservedAt, row.statusSource)],
  ]),
  id: row.entityId,
  kind: 'topic',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const readTask = (row: typeof projectionTasks.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    [
      'assignment',
      readFragment(row.assignmentData, row.assignmentObservedAt, row.assignmentSource),
    ],
    [
      'description',
      readFragment(row.descriptionData, row.descriptionObservedAt, row.descriptionSource),
    ],
    ['display', readFragment(row.displayData, row.displayObservedAt, row.displaySource)],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
    ['lifecycle', readFragment(row.lifecycleData, row.lifecycleObservedAt, row.lifecycleSource)],
  ]),
  id: row.entityId,
  kind: 'task',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const readBrief = (row: typeof projectionBriefs.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    ['actions', readFragment(row.actionsData, row.actionsObservedAt, row.actionsSource)],
    ['content', readFragment(row.contentData, row.contentObservedAt, row.contentSource)],
    ['readState', readFragment(row.readStateData, row.readStateObservedAt, row.readStateSource)],
    ['relations', readFragment(row.relationsData, row.relationsObservedAt, row.relationsSource)],
    [
      'resolution',
      readFragment(row.resolutionData, row.resolutionObservedAt, row.resolutionSource),
    ],
  ]),
  id: row.entityId,
  kind: 'brief',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const inspectRecord = (scope: string, record: DesktopProjectionRecord): string =>
  superjson.stringify({
    schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
    scope,
    value: {
      ...record,
      fragments: Object.fromEntries(
        Object.entries(record.fragments).map(([name, fragment]) => [
          name,
          { ...fragment, data: superjson.parse(fragment.data) },
        ]),
      ),
    },
  });

const inspectIndex = (index: DesktopProjectionIndex): string =>
  superjson.stringify({
    ...superjson.parse<Record<string, unknown>>(index.data),
    key: index.key,
    observedAt: index.observedAt,
    source: index.source,
  });

const inspectSnapshot = (snapshot: DesktopProjectionSnapshot): string =>
  superjson.stringify({
    data: superjson.parse(snapshot.data),
    key: snapshot.key,
    observedAt: snapshot.observedAt,
    source: snapshot.source,
  });

export default class ProjectionCacheService extends ServiceModule {
  private get runtime() {
    return this.app.getService(LocalDatabaseService).getRuntime();
  }

  private get localDatabase() {
    return this.app.getService(LocalDatabaseService);
  }

  async clearScope(scope: string): Promise<void> {
    await this.localDatabase.runWrite(() =>
      this.runtime.db.transaction(async (tx) => {
        await tx.delete(projectionAgents).where(eq(projectionAgents.scope, scope)).run();
        await tx.delete(projectionBriefs).where(eq(projectionBriefs.scope, scope)).run();
        await tx.delete(projectionChatGroups).where(eq(projectionChatGroups.scope, scope)).run();
        await tx.delete(projectionTopics).where(eq(projectionTopics.scope, scope)).run();
        await tx.delete(projectionTasks).where(eq(projectionTasks.scope, scope)).run();
        await tx.delete(projectionHomeIndexes).where(eq(projectionHomeIndexes.scope, scope)).run();
        await tx
          .delete(projectionHomeSnapshots)
          .where(eq(projectionHomeSnapshots.scope, scope))
          .run();
      }),
    );
  }

  async commit(commit: DesktopProjectionCommit): Promise<void> {
    assertCommit(commit);

    await this.localDatabase.runWrite(() =>
      this.runtime.db.transaction(async (tx) => {
        for (const record of commit.records ?? []) {
          switch (record.kind) {
            case 'agent': {
              const values = agentValues(commit.scope, record);
              await tx
                .insert(projectionAgents)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionAgents.storageId })
                .run();
              break;
            }
            case 'brief': {
              const values = briefValues(commit.scope, record);
              await tx
                .insert(projectionBriefs)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionBriefs.storageId })
                .run();
              break;
            }
            case 'chatGroup': {
              const values = chatGroupValues(commit.scope, record);
              await tx
                .insert(projectionChatGroups)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionChatGroups.storageId })
                .run();
              break;
            }
            case 'task': {
              const values = taskValues(commit.scope, record);
              await tx
                .insert(projectionTasks)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionTasks.storageId })
                .run();
              break;
            }
            case 'topic': {
              const values = topicValues(commit.scope, record);
              await tx
                .insert(projectionTopics)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionTopics.storageId })
                .run();
              break;
            }
          }
        }

        for (const item of commit.indexes ?? []) {
          const values = {
            data: item.data,
            key: item.key as typeof projectionHomeIndexes.$inferInsert.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: storageId(commit.scope, item.key),
          };
          await tx
            .insert(projectionHomeIndexes)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionHomeIndexes.storageId })
            .run();
        }

        for (const item of commit.snapshots ?? []) {
          const values = {
            data: item.data,
            key: item.key as typeof projectionHomeSnapshots.$inferInsert.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: storageId(commit.scope, item.key),
          };
          await tx
            .insert(projectionHomeSnapshots)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionHomeSnapshots.storageId })
            .run();
        }
      }),
    );
  }

  async hydrateScope(scope: string): Promise<DesktopProjectionHydration> {
    const database = this.runtime.db;
    const agentRows = await database
      .select()
      .from(projectionAgents)
      .where(
        and(
          eq(projectionAgents.scope, scope),
          eq(projectionAgents.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionAgents.entityId));
    const briefRows = await database
      .select()
      .from(projectionBriefs)
      .where(
        and(
          eq(projectionBriefs.scope, scope),
          eq(projectionBriefs.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionBriefs.entityId));
    const chatGroupRows = await database
      .select()
      .from(projectionChatGroups)
      .where(
        and(
          eq(projectionChatGroups.scope, scope),
          eq(projectionChatGroups.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionChatGroups.entityId));
    const taskRows = await database
      .select()
      .from(projectionTasks)
      .where(
        and(
          eq(projectionTasks.scope, scope),
          eq(projectionTasks.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionTasks.entityId));
    const topicRows = await database
      .select()
      .from(projectionTopics)
      .where(
        and(
          eq(projectionTopics.scope, scope),
          eq(projectionTopics.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionTopics.entityId));
    const indexRows = await database
      .select()
      .from(projectionHomeIndexes)
      .where(
        and(
          eq(projectionHomeIndexes.scope, scope),
          eq(projectionHomeIndexes.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionHomeIndexes.key));
    const snapshotRows = await database
      .select()
      .from(projectionHomeSnapshots)
      .where(
        and(
          eq(projectionHomeSnapshots.scope, scope),
          eq(projectionHomeSnapshots.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
        ),
      )
      .orderBy(asc(projectionHomeSnapshots.key));

    return {
      indexes: indexRows.map(({ data, key, observedAt, source }) => ({
        data,
        key,
        observedAt,
        source,
      })),
      records: [
        ...agentRows.map(readAgent),
        ...briefRows.map(readBrief),
        ...chatGroupRows.map(readChatGroup),
        ...taskRows.map(readTask),
        ...topicRows.map(readTopic),
      ],
      snapshots: snapshotRows.map(({ data, key, observedAt, source }) => ({
        data,
        key,
        observedAt,
        source,
      })),
    };
  }

  isCollection(collection: string): boolean {
    return Object.values(DESKTOP_PROJECTION_CACHE_TABLES).includes(
      collection as (typeof DESKTOP_PROJECTION_CACHE_TABLES)[keyof typeof DESKTOP_PROJECTION_CACHE_TABLES],
    );
  }

  async listCollections(): Promise<DesktopLocalDatabaseCollectionInfo[]> {
    const database = this.runtime.db;
    const tables = [
      [DESKTOP_PROJECTION_CACHE_TABLES.agent, projectionAgents],
      [DESKTOP_PROJECTION_CACHE_TABLES.brief, projectionBriefs],
      [DESKTOP_PROJECTION_CACHE_TABLES.chatGroup, projectionChatGroups],
      [DESKTOP_PROJECTION_CACHE_TABLES.homeIndexes, projectionHomeIndexes],
      [DESKTOP_PROJECTION_CACHE_TABLES.homeSnapshots, projectionHomeSnapshots],
      [DESKTOP_PROJECTION_CACHE_TABLES.task, projectionTasks],
      [DESKTOP_PROJECTION_CACHE_TABLES.topic, projectionTopics],
    ] as const;

    const collections: DesktopLocalDatabaseCollectionInfo[] = [];
    for (const [name, table] of tables) {
      const [row] = await database.select({ entryCount: count() }).from(table);
      collections.push({ entryCount: row?.entryCount ?? 0, name });
    }
    return collections;
  }

  async inspectEntries(collection: string, prefix: string): Promise<DesktopLocalDatabaseEntry[]> {
    const hydration = await this.hydrateAll();
    const matchesPrefix = ({ key }: DesktopLocalDatabaseEntry) => key.startsWith(prefix);

    switch (collection) {
      case DESKTOP_PROJECTION_CACHE_TABLES.agent: {
        return hydration.agents
          .map(({ record, scope }) => ({
            key: storageId(scope, record.id),
            value: inspectRecord(scope, record),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.brief: {
        return hydration.briefs
          .map(({ record, scope }) => ({
            key: storageId(scope, record.id),
            value: inspectRecord(scope, record),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.chatGroup: {
        return hydration.chatGroups
          .map(({ record, scope }) => ({
            key: storageId(scope, record.id),
            value: inspectRecord(scope, record),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.task: {
        return hydration.tasks
          .map(({ record, scope }) => ({
            key: storageId(scope, record.id),
            value: inspectRecord(scope, record),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.topic: {
        return hydration.topics
          .map(({ record, scope }) => ({
            key: storageId(scope, record.id),
            value: inspectRecord(scope, record),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.homeIndexes: {
        return hydration.indexes
          .map(({ item, scope }) => ({
            key: storageId(scope, item.key),
            value: inspectIndex(item),
          }))
          .filter(matchesPrefix);
      }
      case DESKTOP_PROJECTION_CACHE_TABLES.homeSnapshots: {
        return hydration.snapshots
          .map(({ item, scope }) => ({
            key: storageId(scope, item.key),
            value: inspectSnapshot(item),
          }))
          .filter(matchesPrefix);
      }
      default: {
        return [];
      }
    }
  }

  private async hydrateAll() {
    const database = this.runtime.db;
    const agentRows = await database
      .select()
      .from(projectionAgents)
      .orderBy(asc(projectionAgents.storageId));
    const briefRows = await database
      .select()
      .from(projectionBriefs)
      .orderBy(asc(projectionBriefs.storageId));
    const chatGroupRows = await database
      .select()
      .from(projectionChatGroups)
      .orderBy(asc(projectionChatGroups.storageId));
    const taskRows = await database
      .select()
      .from(projectionTasks)
      .orderBy(asc(projectionTasks.storageId));
    const topicRows = await database
      .select()
      .from(projectionTopics)
      .orderBy(asc(projectionTopics.storageId));
    const indexRows = await database
      .select()
      .from(projectionHomeIndexes)
      .orderBy(asc(projectionHomeIndexes.storageId));
    const snapshotRows = await database
      .select()
      .from(projectionHomeSnapshots)
      .orderBy(asc(projectionHomeSnapshots.storageId));

    return {
      agents: agentRows.map((row) => ({ record: readAgent(row), scope: row.scope })),
      briefs: briefRows.map((row) => ({ record: readBrief(row), scope: row.scope })),
      chatGroups: chatGroupRows.map((row) => ({ record: readChatGroup(row), scope: row.scope })),
      indexes: indexRows.map((row) => ({
        item: { data: row.data, key: row.key, observedAt: row.observedAt, source: row.source },
        scope: row.scope,
      })),
      snapshots: snapshotRows.map((row) => ({
        item: { data: row.data, key: row.key, observedAt: row.observedAt, source: row.source },
        scope: row.scope,
      })),
      tasks: taskRows.map((row) => ({ record: readTask(row), scope: row.scope })),
      topics: topicRows.map((row) => ({ record: readTopic(row), scope: row.scope })),
    };
  }
}
