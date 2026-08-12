import type {
  DesktopLocalDatabaseCollectionInfo,
  DesktopLocalDatabaseEntry,
  DesktopProjectionCommit,
  DesktopProjectionFragment,
  DesktopProjectionHydration,
  DesktopProjectionHydrationRequest,
  DesktopProjectionIndex,
  DesktopProjectionKind,
  DesktopProjectionRecord,
  DesktopProjectionSnapshot,
  DesktopProjectionSource,
} from '@lobechat/electron-client-ipc';
import { DESKTOP_PROJECTION_CACHE_TABLES } from '@lobechat/electron-client-ipc';
import { and, asc, count, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
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
const SOURCE_PRIORITY: Record<DesktopProjectionSource, number> = {
  mutation: 3,
  network: 1,
  realtime: 2,
};

const shouldReplaceObservation = (
  current: { observedAt: number; source: DesktopProjectionSource } | undefined,
  incoming: { observedAt: number; source: DesktopProjectionSource },
): boolean =>
  !current ||
  incoming.observedAt > current.observedAt ||
  (incoming.observedAt === current.observedAt &&
    SOURCE_PRIORITY[incoming.source] >= SOURCE_PRIORITY[current.source]);

const mergeDesktopProjectionRecord = (
  current: DesktopProjectionRecord | undefined,
  incoming: DesktopProjectionRecord,
): DesktopProjectionRecord => {
  const tombstoneAt =
    current?.tombstoneAt === undefined
      ? incoming.tombstoneAt
      : incoming.tombstoneAt === undefined
        ? current.tombstoneAt
        : Math.max(current.tombstoneAt, incoming.tombstoneAt);
  const fragments = Object.fromEntries(
    Object.entries(current?.fragments ?? {}).filter(
      ([, fragment]) => tombstoneAt === undefined || fragment.observedAt > tombstoneAt,
    ),
  );

  for (const [name, candidate] of Object.entries(incoming.fragments)) {
    if (tombstoneAt !== undefined && candidate.observedAt <= tombstoneAt) continue;
    if (!shouldReplaceObservation(fragments[name], candidate)) continue;
    fragments[name] = candidate;
  }

  return {
    fragments,
    id: incoming.id,
    kind: incoming.kind,
    ...(tombstoneAt === undefined ? {} : { tombstoneAt }),
  } as DesktopProjectionRecord;
};
const STATIC_INDEX_KEYS = new Set([
  'agent.available',
  'agent.directory',
  'chatGroup.list',
  'home.inboxTopics',
  'home.recentTopics',
  'home.scheduledTasks',
  'home.sidebar',
  'home.tasks',
  'home.unresolvedBriefs',
]);
const INDEX_PREFIXES = [
  'agent.search:',
  'brief.news:',
  'chat.agentViewTopics:',
  'chat.sidebarTopics:',
  'task.groupList:',
  'task.list:',
];
const isIndexKey = (key: string): boolean =>
  STATIC_INDEX_KEYS.has(key) || INDEX_PREFIXES.some((prefix) => key.startsWith(prefix));
const HOME_SNAPSHOT_KEYS = new Set(['home.dailyBrief']);
const FRAGMENTS: Record<DesktopProjectionKind, ReadonlySet<string>> = {
  agent: new Set([
    'access',
    'configuration',
    'identity',
    'knowledge',
    'lifecycle',
    'profile',
    'routing',
    'runtime',
  ]),
  brief: new Set(['actions', 'content', 'readState', 'relations', 'resolution']),
  chatGroup: new Set(['access', 'configuration', 'identity', 'lifecycle', 'membership']),
  task: new Set([
    'assignment',
    'description',
    'detail',
    'display',
    'identity',
    'lifecycle',
    'participants',
    'row',
  ]),
  topic: new Set([
    'activity',
    'analytics',
    'completion',
    'creation',
    'details',
    'display',
    'generation',
    'marking',
    'navigation',
    'ordering',
    'ownership',
    'preview',
    'routing',
    'runTiming',
    'status',
    'summary',
    'triggerInfo',
  ]),
};

const projectionRefKey = (kind: DesktopProjectionKind, id: string): string => `${kind}:${id}`;

const collectIndexRefs = (
  serialized: string,
): Map<string, { id: string; kind: DesktopProjectionKind }> => {
  const refs = new Map<string, { id: string; kind: DesktopProjectionKind }>();
  try {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (!value || typeof value !== 'object') return;

      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.id === 'string' &&
        typeof candidate.kind === 'string' &&
        candidate.kind in FRAGMENTS
      ) {
        const kind = candidate.kind as DesktopProjectionKind;
        refs.set(projectionRefKey(kind, candidate.id), { id: candidate.id, kind });
      }
      for (const nested of Object.values(candidate)) visit(nested);
    };

    visit(superjson.parse(serialized));
  } catch {
    // Commit validation already guarantees valid serialized JSON. If an older
    // row cannot be decoded, retain its records rather than risking eager GC.
  }
  return refs;
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
    if (!isIndexKey(index.key)) throw new Error(`Unsupported Projection index: ${index.key}`);
    assertObservation(index, index.key);
  }

  for (const snapshot of commit.snapshots ?? []) {
    if (!HOME_SNAPSHOT_KEYS.has(snapshot.key)) {
      throw new Error(`Unsupported Projection snapshot: ${snapshot.key}`);
    }
    assertObservation(snapshot, snapshot.key);
  }
};

const assertHydrationRequest = (request: DesktopProjectionHydrationRequest): void => {
  if (!request.scope) throw new Error('Projection cache scope is required');
  for (const key of request.indexes ?? []) {
    if (!isIndexKey(key)) throw new Error(`Unsupported Projection index: ${key}`);
  }
  for (const key of request.snapshots ?? []) {
    if (!HOME_SNAPSHOT_KEYS.has(key)) {
      throw new Error(`Unsupported Projection snapshot: ${key}`);
    }
  }
  for (const record of request.records ?? []) {
    const allowedFragments = FRAGMENTS[record.kind];
    if (!allowedFragments) throw new Error(`Unsupported Projection kind: ${record.kind}`);
    if (record.ids.some((id) => !id)) {
      throw new Error(`Projection ${record.kind} hydration contains an empty entity id`);
    }
    for (const fragment of record.fragments) {
      if (!allowedFragments.has(fragment)) {
        throw new Error(`Unsupported ${record.kind} fragment: ${fragment}`);
      }
    }
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
  const configuration = fragmentValues(record.fragments.configuration);
  const identity = fragmentValues(record.fragments.identity);
  const knowledge = fragmentValues(record.fragments.knowledge);
  const lifecycle = fragmentValues(record.fragments.lifecycle);
  const profile = fragmentValues(record.fragments.profile);
  const routing = fragmentValues(record.fragments.routing);
  const runtime = fragmentValues(record.fragments.runtime);

  return {
    ...entityValues(scope, record),
    accessData: access.data,
    accessObservedAt: access.observedAt,
    accessSource: access.source,
    configurationData: configuration.data,
    configurationObservedAt: configuration.observedAt,
    configurationSource: configuration.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
    knowledgeData: knowledge.data,
    knowledgeObservedAt: knowledge.observedAt,
    knowledgeSource: knowledge.source,
    lifecycleData: lifecycle.data,
    lifecycleObservedAt: lifecycle.observedAt,
    lifecycleSource: lifecycle.source,
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
  const configuration = fragmentValues(record.fragments.configuration);
  const identity = fragmentValues(record.fragments.identity);
  const lifecycle = fragmentValues(record.fragments.lifecycle);
  const membership = fragmentValues(record.fragments.membership);

  return {
    ...entityValues(scope, record),
    accessData: access.data,
    accessObservedAt: access.observedAt,
    accessSource: access.source,
    configurationData: configuration.data,
    configurationObservedAt: configuration.observedAt,
    configurationSource: configuration.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
    lifecycleData: lifecycle.data,
    lifecycleObservedAt: lifecycle.observedAt,
    lifecycleSource: lifecycle.source,
    membershipData: membership.data,
    membershipObservedAt: membership.observedAt,
    membershipSource: membership.source,
  };
};

const topicValues = (scope: string, record: DesktopProjectionRecord) => {
  const activity = fragmentValues(record.fragments.activity);
  const analytics = fragmentValues(record.fragments.analytics);
  const completion = fragmentValues(record.fragments.completion);
  const creation = fragmentValues(record.fragments.creation);
  const details = fragmentValues(record.fragments.details);
  const display = fragmentValues(record.fragments.display);
  const generation = fragmentValues(record.fragments.generation);
  const marking = fragmentValues(record.fragments.marking);
  const navigation = fragmentValues(record.fragments.navigation);
  const ordering = fragmentValues(record.fragments.ordering);
  const ownership = fragmentValues(record.fragments.ownership);
  const preview = fragmentValues(record.fragments.preview);
  const routing = fragmentValues(record.fragments.routing);
  const runTiming = fragmentValues(record.fragments.runTiming);
  const status = fragmentValues(record.fragments.status);
  const summary = fragmentValues(record.fragments.summary);
  const triggerInfo = fragmentValues(record.fragments.triggerInfo);

  return {
    ...entityValues(scope, record),
    activityData: activity.data,
    activityObservedAt: activity.observedAt,
    activitySource: activity.source,
    analyticsData: analytics.data,
    analyticsObservedAt: analytics.observedAt,
    analyticsSource: analytics.source,
    completionData: completion.data,
    completionObservedAt: completion.observedAt,
    completionSource: completion.source,
    creationData: creation.data,
    creationObservedAt: creation.observedAt,
    creationSource: creation.source,
    detailsData: details.data,
    detailsObservedAt: details.observedAt,
    detailsSource: details.source,
    displayData: display.data,
    displayObservedAt: display.observedAt,
    displaySource: display.source,
    generationData: generation.data,
    generationObservedAt: generation.observedAt,
    generationSource: generation.source,
    markingData: marking.data,
    markingObservedAt: marking.observedAt,
    markingSource: marking.source,
    navigationData: navigation.data,
    navigationObservedAt: navigation.observedAt,
    navigationSource: navigation.source,
    orderingData: ordering.data,
    orderingObservedAt: ordering.observedAt,
    orderingSource: ordering.source,
    ownershipData: ownership.data,
    ownershipObservedAt: ownership.observedAt,
    ownershipSource: ownership.source,
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
    summaryData: summary.data,
    summaryObservedAt: summary.observedAt,
    summarySource: summary.source,
    triggerInfoData: triggerInfo.data,
    triggerInfoObservedAt: triggerInfo.observedAt,
    triggerInfoSource: triggerInfo.source,
  };
};

const taskValues = (scope: string, record: DesktopProjectionRecord) => {
  const assignment = fragmentValues(record.fragments.assignment);
  const description = fragmentValues(record.fragments.description);
  const detail = fragmentValues(record.fragments.detail);
  const display = fragmentValues(record.fragments.display);
  const identity = fragmentValues(record.fragments.identity);
  const lifecycle = fragmentValues(record.fragments.lifecycle);
  const participants = fragmentValues(record.fragments.participants);
  const row = fragmentValues(record.fragments.row);

  return {
    ...entityValues(scope, record),
    assignmentData: assignment.data,
    assignmentObservedAt: assignment.observedAt,
    assignmentSource: assignment.source,
    descriptionData: description.data,
    descriptionObservedAt: description.observedAt,
    descriptionSource: description.source,
    detailData: detail.data,
    detailObservedAt: detail.observedAt,
    detailSource: detail.source,
    displayData: display.data,
    displayObservedAt: display.observedAt,
    displaySource: display.source,
    identityData: identity.data,
    identityObservedAt: identity.observedAt,
    identitySource: identity.source,
    lifecycleData: lifecycle.data,
    lifecycleObservedAt: lifecycle.observedAt,
    lifecycleSource: lifecycle.source,
    participantsData: participants.data,
    participantsObservedAt: participants.observedAt,
    participantsSource: participants.source,
    rowData: row.data,
    rowObservedAt: row.observedAt,
    rowSource: row.source,
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
    [
      'configuration',
      readFragment(row.configurationData, row.configurationObservedAt, row.configurationSource),
    ],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
    ['knowledge', readFragment(row.knowledgeData, row.knowledgeObservedAt, row.knowledgeSource)],
    ['lifecycle', readFragment(row.lifecycleData, row.lifecycleObservedAt, row.lifecycleSource)],
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
    [
      'configuration',
      readFragment(row.configurationData, row.configurationObservedAt, row.configurationSource),
    ],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
    ['lifecycle', readFragment(row.lifecycleData, row.lifecycleObservedAt, row.lifecycleSource)],
    [
      'membership',
      readFragment(row.membershipData, row.membershipObservedAt, row.membershipSource),
    ],
  ]),
  id: row.entityId,
  kind: 'chatGroup',
  ...(row.tombstoneAt === null ? {} : { tombstoneAt: row.tombstoneAt }),
});

const readTopic = (row: typeof projectionTopics.$inferSelect): DesktopProjectionRecord => ({
  fragments: compactFragments([
    ['activity', readFragment(row.activityData, row.activityObservedAt, row.activitySource)],
    ['analytics', readFragment(row.analyticsData, row.analyticsObservedAt, row.analyticsSource)],
    [
      'completion',
      readFragment(row.completionData, row.completionObservedAt, row.completionSource),
    ],
    ['creation', readFragment(row.creationData, row.creationObservedAt, row.creationSource)],
    ['details', readFragment(row.detailsData, row.detailsObservedAt, row.detailsSource)],
    ['display', readFragment(row.displayData, row.displayObservedAt, row.displaySource)],
    [
      'generation',
      readFragment(row.generationData, row.generationObservedAt, row.generationSource),
    ],
    ['marking', readFragment(row.markingData, row.markingObservedAt, row.markingSource)],
    [
      'navigation',
      readFragment(row.navigationData, row.navigationObservedAt, row.navigationSource),
    ],
    ['ordering', readFragment(row.orderingData, row.orderingObservedAt, row.orderingSource)],
    ['ownership', readFragment(row.ownershipData, row.ownershipObservedAt, row.ownershipSource)],
    ['preview', readFragment(row.previewData, row.previewObservedAt, row.previewSource)],
    ['routing', readFragment(row.routingData, row.routingObservedAt, row.routingSource)],
    ['runTiming', readFragment(row.runTimingData, row.runTimingObservedAt, row.runTimingSource)],
    ['status', readFragment(row.statusData, row.statusObservedAt, row.statusSource)],
    ['summary', readFragment(row.summaryData, row.summaryObservedAt, row.summarySource)],
    [
      'triggerInfo',
      readFragment(row.triggerInfoData, row.triggerInfoObservedAt, row.triggerInfoSource),
    ],
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
    ['detail', readFragment(row.detailData, row.detailObservedAt, row.detailSource)],
    ['display', readFragment(row.displayData, row.displayObservedAt, row.displaySource)],
    ['identity', readFragment(row.identityData, row.identityObservedAt, row.identitySource)],
    ['lifecycle', readFragment(row.lifecycleData, row.lifecycleObservedAt, row.lifecycleSource)],
    [
      'participants',
      readFragment(row.participantsData, row.participantsObservedAt, row.participantsSource),
    ],
    ['row', readFragment(row.rowData, row.rowObservedAt, row.rowSource)],
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

const selectRecordFragments = (
  record: DesktopProjectionRecord,
  requested: ReadonlySet<string>,
): DesktopProjectionRecord => ({
  ...record,
  fragments: Object.fromEntries(
    Object.entries(record.fragments).filter(([name]) => requested.has(name)),
  ),
});

const requestedFragmentsForRecord = (
  kind: DesktopProjectionKind,
  record: DesktopProjectionRecord,
  requests: Map<string, Set<string>>,
): ReadonlySet<string> => {
  const direct = requests.get(record.id);
  if (direct || kind !== 'task') return direct ?? new Set();

  const identity = record.fragments.identity;
  if (!identity) return new Set();
  try {
    const { identifier } = superjson.parse<{ identifier?: unknown }>(identity.data);
    return typeof identifier === 'string' ? (requests.get(identifier) ?? new Set()) : new Set();
  } catch {
    return new Set();
  }
};

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
        const gcCandidates = new Map<string, { id: string; kind: DesktopProjectionKind }>();
        const committedRecords = new Set(
          (commit.records ?? []).map((record) => projectionRefKey(record.kind, record.id)),
        );

        for (const record of commit.records ?? []) {
          switch (record.kind) {
            case 'agent': {
              const [stored] = await tx
                .select()
                .from(projectionAgents)
                .where(eq(projectionAgents.storageId, storageId(commit.scope, record.id)))
                .limit(1);
              const merged = mergeDesktopProjectionRecord(
                stored ? readAgent(stored) : undefined,
                record,
              );
              const values = agentValues(commit.scope, merged);
              await tx
                .insert(projectionAgents)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionAgents.storageId })
                .run();
              break;
            }
            case 'brief': {
              const [stored] = await tx
                .select()
                .from(projectionBriefs)
                .where(eq(projectionBriefs.storageId, storageId(commit.scope, record.id)))
                .limit(1);
              const merged = mergeDesktopProjectionRecord(
                stored ? readBrief(stored) : undefined,
                record,
              );
              const values = briefValues(commit.scope, merged);
              await tx
                .insert(projectionBriefs)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionBriefs.storageId })
                .run();
              break;
            }
            case 'chatGroup': {
              const [stored] = await tx
                .select()
                .from(projectionChatGroups)
                .where(eq(projectionChatGroups.storageId, storageId(commit.scope, record.id)))
                .limit(1);
              const merged = mergeDesktopProjectionRecord(
                stored ? readChatGroup(stored) : undefined,
                record,
              );
              const values = chatGroupValues(commit.scope, merged);
              await tx
                .insert(projectionChatGroups)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionChatGroups.storageId })
                .run();
              break;
            }
            case 'task': {
              const [stored] = await tx
                .select()
                .from(projectionTasks)
                .where(eq(projectionTasks.storageId, storageId(commit.scope, record.id)))
                .limit(1);
              const merged = mergeDesktopProjectionRecord(
                stored ? readTask(stored) : undefined,
                record,
              );
              const values = taskValues(commit.scope, merged);
              await tx
                .insert(projectionTasks)
                .values(values)
                .onConflictDoUpdate({ set: values, target: projectionTasks.storageId })
                .run();
              break;
            }
            case 'topic': {
              const [stored] = await tx
                .select()
                .from(projectionTopics)
                .where(eq(projectionTopics.storageId, storageId(commit.scope, record.id)))
                .limit(1);
              const merged = mergeDesktopProjectionRecord(
                stored ? readTopic(stored) : undefined,
                record,
              );
              const values = topicValues(commit.scope, merged);
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
          const itemStorageId = storageId(commit.scope, item.key);
          const [stored] = await tx
            .select({
              data: projectionHomeIndexes.data,
              observedAt: projectionHomeIndexes.observedAt,
              source: projectionHomeIndexes.source,
            })
            .from(projectionHomeIndexes)
            .where(eq(projectionHomeIndexes.storageId, itemStorageId))
            .limit(1);
          if (stored && !shouldReplaceObservation(stored, item)) continue;
          if (stored) {
            for (const [key, ref] of collectIndexRefs(stored.data)) gcCandidates.set(key, ref);
          }
          const values = {
            data: item.data,
            key: item.key as typeof projectionHomeIndexes.$inferInsert.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: itemStorageId,
          };
          await tx
            .insert(projectionHomeIndexes)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionHomeIndexes.storageId })
            .run();
        }

        for (const item of commit.snapshots ?? []) {
          const itemStorageId = storageId(commit.scope, item.key);
          const [stored] = await tx
            .select({
              observedAt: projectionHomeSnapshots.observedAt,
              source: projectionHomeSnapshots.source,
            })
            .from(projectionHomeSnapshots)
            .where(eq(projectionHomeSnapshots.storageId, itemStorageId))
            .limit(1);
          if (stored && !shouldReplaceObservation(stored, item)) continue;
          const values = {
            data: item.data,
            key: item.key as typeof projectionHomeSnapshots.$inferInsert.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: itemStorageId,
          };
          await tx
            .insert(projectionHomeSnapshots)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionHomeSnapshots.storageId })
            .run();
        }

        if (gcCandidates.size > 0) {
          const persistedIndexes = await tx
            .select({ data: projectionHomeIndexes.data })
            .from(projectionHomeIndexes)
            .where(eq(projectionHomeIndexes.scope, commit.scope));
          const retained = new Set<string>();
          for (const { data } of persistedIndexes) {
            for (const key of collectIndexRefs(data).keys()) retained.add(key);
          }

          for (const [key, candidate] of gcCandidates) {
            if (retained.has(key) || committedRecords.has(key)) continue;
            switch (candidate.kind) {
              case 'agent': {
                await tx
                  .delete(projectionAgents)
                  .where(
                    and(
                      eq(projectionAgents.scope, commit.scope),
                      eq(projectionAgents.entityId, candidate.id),
                      isNull(projectionAgents.tombstoneAt),
                    ),
                  )
                  .run();
                break;
              }
              case 'brief': {
                await tx
                  .delete(projectionBriefs)
                  .where(
                    and(
                      eq(projectionBriefs.scope, commit.scope),
                      eq(projectionBriefs.entityId, candidate.id),
                      isNull(projectionBriefs.tombstoneAt),
                    ),
                  )
                  .run();
                break;
              }
              case 'chatGroup': {
                await tx
                  .delete(projectionChatGroups)
                  .where(
                    and(
                      eq(projectionChatGroups.scope, commit.scope),
                      eq(projectionChatGroups.entityId, candidate.id),
                      isNull(projectionChatGroups.tombstoneAt),
                    ),
                  )
                  .run();
                break;
              }
              case 'task': {
                await tx
                  .delete(projectionTasks)
                  .where(
                    and(
                      eq(projectionTasks.scope, commit.scope),
                      eq(projectionTasks.entityId, candidate.id),
                      isNull(projectionTasks.tombstoneAt),
                    ),
                  )
                  .run();
                break;
              }
              case 'topic': {
                await tx
                  .delete(projectionTopics)
                  .where(
                    and(
                      eq(projectionTopics.scope, commit.scope),
                      eq(projectionTopics.entityId, candidate.id),
                      isNull(projectionTopics.tombstoneAt),
                    ),
                  )
                  .run();
                break;
              }
            }
          }
        }
      }),
    );
  }

  async hydrate(request: DesktopProjectionHydrationRequest): Promise<DesktopProjectionHydration> {
    assertHydrationRequest(request);
    const database = this.runtime.db;
    const recordsByKind = new Map<DesktopProjectionKind, Map<string, Set<string>>>();
    for (const record of request.records ?? []) {
      const byId = recordsByKind.get(record.kind) ?? new Map<string, Set<string>>();
      for (const id of record.ids) {
        const fragments = byId.get(id) ?? new Set<string>();
        for (const fragment of record.fragments) fragments.add(fragment);
        byId.set(id, fragments);
      }
      recordsByKind.set(record.kind, byId);
    }

    const readRequested = async <T>(
      kind: DesktopProjectionKind,
      table: AnySQLiteTable & {
        entityId: AnySQLiteColumn;
        schemaVersion: AnySQLiteColumn;
        scope: AnySQLiteColumn;
      },
      read: (row: T) => DesktopProjectionRecord,
      matchIds?: (ids: string[]) => SQL | undefined,
    ): Promise<DesktopProjectionRecord[]> => {
      const byId = recordsByKind.get(kind);
      if (!byId || byId.size === 0) return [];
      const ids = [...byId.keys()];
      const rows = (await database
        .select()
        .from(table)
        .where(
          and(
            eq(table.scope, request.scope),
            eq(table.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
            matchIds?.(ids) ?? inArray(table.entityId, ids),
          ),
        )
        .orderBy(asc(table.entityId))) as T[];
      return rows.map((row) => {
        const record = read(row);
        return selectRecordFragments(record, requestedFragmentsForRecord(kind, record, byId));
      });
    };

    const indexKeys = request.indexes ?? [];
    const snapshotKeys = (request.snapshots ?? []) as 'home.dailyBrief'[];
    const databaseReadStartedAt = performance.now();
    const [agentRows, briefRows, chatGroupRows, taskRows, topicRows, indexRows, snapshotRows] =
      await Promise.all([
        readRequested('agent', projectionAgents, readAgent),
        readRequested('brief', projectionBriefs, readBrief),
        readRequested('chatGroup', projectionChatGroups, readChatGroup),
        readRequested('task', projectionTasks, readTask, (ids) =>
          or(
            inArray(projectionTasks.entityId, ids),
            inArray(
              sql<string>`json_extract(${projectionTasks.identityData}, '$.json.identifier')`,
              ids,
            ),
          ),
        ),
        readRequested('topic', projectionTopics, readTopic),
        indexKeys.length === 0
          ? []
          : database
              .select()
              .from(projectionHomeIndexes)
              .where(
                and(
                  eq(projectionHomeIndexes.scope, request.scope),
                  eq(projectionHomeIndexes.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
                  inArray(projectionHomeIndexes.key, indexKeys),
                ),
              )
              .orderBy(asc(projectionHomeIndexes.key)),
        snapshotKeys.length === 0
          ? []
          : database
              .select()
              .from(projectionHomeSnapshots)
              .where(
                and(
                  eq(projectionHomeSnapshots.scope, request.scope),
                  eq(projectionHomeSnapshots.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
                  inArray(projectionHomeSnapshots.key, snapshotKeys),
                ),
              )
              .orderBy(asc(projectionHomeSnapshots.key)),
      ]);

    const hydration: DesktopProjectionHydration = {
      indexes: indexRows.map(({ data, key, observedAt, source }) => ({
        data,
        key,
        observedAt,
        source,
      })),
      records: [...agentRows, ...briefRows, ...chatGroupRows, ...taskRows, ...topicRows],
      snapshots: snapshotRows.map(({ data, key, observedAt, source }) => ({
        data,
        key,
        observedAt,
        source,
      })),
    };

    return {
      ...hydration,
      timing: { databaseReadMs: performance.now() - databaseReadStartedAt },
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
