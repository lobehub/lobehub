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
import {
  isProjectionFragmentName,
  isProjectionIndexKey,
  isProjectionKind,
  isProjectionSnapshotKey,
  isProjectionSource,
  isProjectionTimestamp,
  mergeProjectionRecord,
  shouldReplaceProjectionObservation,
} from '@lobechat/types';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import superjson from 'superjson';

import {
  PROJECTION_CACHE_SCHEMA_VERSION,
  projectionIndexes,
  projectionSnapshots,
} from '@/database/schema';

import { ServiceModule } from './index';
import LocalDatabaseService from './LocalDatabaseSrv';
import {
  PROJECTION_ENTITY_ADAPTER_LIST,
  PROJECTION_ENTITY_ADAPTERS,
  type ProjectionEntityAdapter,
  projectionStorageId,
} from './projectionCache/entityAdapters';

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
      if (typeof candidate.id === 'string' && isProjectionKind(candidate.kind)) {
        refs.set(projectionRefKey(candidate.kind, candidate.id), {
          id: candidate.id,
          kind: candidate.kind,
        });
      }
      for (const nested of Object.values(candidate)) visit(nested);
    };

    visit(superjson.parse(serialized));
  } catch {
    // Commit validation guarantees current rows. Retain records referenced by
    // an older undecodable row instead of risking eager garbage collection.
  }
  return refs;
};

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
  if (!isProjectionTimestamp(value.observedAt)) {
    throw new Error(`${label}.observedAt is invalid`);
  }
  if (!isProjectionSource(value.source)) throw new Error(`${label}.source is invalid`);
};

const assertCommit = (commit: DesktopProjectionCommit): void => {
  if (!commit.scope) throw new Error('Projection cache scope is required');

  for (const record of commit.records ?? []) {
    if (!record.id) throw new Error('Projection cache entity id is required');
    if (!isProjectionKind(record.kind)) {
      throw new Error(`Unsupported Projection kind: ${String(record.kind)}`);
    }
    if (record.tombstoneAt !== undefined && !isProjectionTimestamp(record.tombstoneAt)) {
      throw new Error(`Invalid tombstone for ${record.kind}:${record.id}`);
    }

    for (const [name, fragment] of Object.entries(record.fragments)) {
      if (!isProjectionFragmentName(record.kind, name)) {
        throw new Error(`Unsupported ${record.kind} fragment: ${name}`);
      }
      assertObservation(fragment, `${record.kind}.${name}`);
    }
  }

  for (const index of commit.indexes ?? []) {
    if (!isProjectionIndexKey(index.key)) {
      throw new Error(`Unsupported Projection index: ${index.key}`);
    }
    assertObservation(index, index.key);
  }

  for (const snapshot of commit.snapshots ?? []) {
    if (!isProjectionSnapshotKey(snapshot.key)) {
      throw new Error(`Unsupported Projection snapshot: ${snapshot.key}`);
    }
    assertObservation(snapshot, snapshot.key);
  }
};

const assertHydrationRequest = (request: DesktopProjectionHydrationRequest): void => {
  if (!request.scope) throw new Error('Projection cache scope is required');
  for (const key of request.indexes ?? []) {
    if (!isProjectionIndexKey(key)) throw new Error(`Unsupported Projection index: ${key}`);
  }
  for (const key of request.snapshots ?? []) {
    if (!isProjectionSnapshotKey(key)) {
      throw new Error(`Unsupported Projection snapshot: ${key}`);
    }
  }
  for (const record of request.records ?? []) {
    if (!isProjectionKind(record.kind)) {
      throw new Error(`Unsupported Projection kind: ${String(record.kind)}`);
    }
    if (record.ids.some((id) => !id)) {
      throw new Error(`Projection ${record.kind} hydration contains an empty entity id`);
    }
    for (const fragment of record.fragments) {
      if (!isProjectionFragmentName(record.kind, fragment)) {
        throw new Error(`Unsupported ${record.kind} fragment: ${fragment}`);
      }
    }
  }
};

const selectRecordFragments = (
  record: DesktopProjectionRecord,
  requested: ReadonlySet<string>,
): DesktopProjectionRecord =>
  ({
    ...record,
    fragments: Object.fromEntries(
      Object.entries(record.fragments).filter(([name]) => requested.has(name)),
    ),
  }) as DesktopProjectionRecord;

const requestedFragmentsForRecord = (
  kind: DesktopProjectionKind,
  record: DesktopProjectionRecord,
  requests: Map<string, Set<string>>,
): ReadonlySet<string> => {
  const direct = requests.get(record.id);
  if (direct || kind !== 'task') return direct ?? new Set();

  const identity = (record.fragments as Record<string, DesktopProjectionFragment | undefined>)
    .identity;
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

const readIndexRow = (row: {
  data: string;
  key: string;
  observedAt: number;
  source: unknown;
}): DesktopProjectionIndex | undefined =>
  isProjectionIndexKey(row.key) && isProjectionSource(row.source)
    ? { data: row.data, key: row.key, observedAt: row.observedAt, source: row.source }
    : undefined;

const readSnapshotRow = (row: {
  data: string;
  key: string;
  observedAt: number;
  source: unknown;
}): DesktopProjectionSnapshot | undefined =>
  isProjectionSnapshotKey(row.key) && isProjectionSource(row.source)
    ? { data: row.data, key: row.key, observedAt: row.observedAt, source: row.source }
    : undefined;

const projectionCollections = new Set<string>(Object.values(DESKTOP_PROJECTION_CACHE_TABLES));

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
        for (const { table } of PROJECTION_ENTITY_ADAPTER_LIST) {
          await tx.delete(table).where(eq(table.scope, scope)).run();
        }
        await tx.delete(projectionIndexes).where(eq(projectionIndexes.scope, scope)).run();
        await tx.delete(projectionSnapshots).where(eq(projectionSnapshots.scope, scope)).run();
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
          const adapter = PROJECTION_ENTITY_ADAPTERS[record.kind] as ProjectionEntityAdapter;
          const [stored] = await tx
            .select()
            .from(adapter.table)
            .where(eq(adapter.table.storageId, projectionStorageId(commit.scope, record.id)))
            .limit(1);
          const merged = mergeProjectionRecord(
            stored ? adapter.read(stored as never) : undefined,
            record,
          );
          const values = adapter.values(commit.scope, merged);
          await tx
            .insert(adapter.table)
            .values(values)
            .onConflictDoUpdate({ set: values, target: adapter.table.storageId })
            .run();
        }

        for (const item of commit.indexes ?? []) {
          const itemStorageId = projectionStorageId(commit.scope, item.key);
          const [stored] = await tx
            .select({
              data: projectionIndexes.data,
              observedAt: projectionIndexes.observedAt,
              source: projectionIndexes.source,
            })
            .from(projectionIndexes)
            .where(eq(projectionIndexes.storageId, itemStorageId))
            .limit(1);
          if (stored && !shouldReplaceProjectionObservation(stored, item)) continue;
          if (stored) {
            for (const [key, ref] of collectIndexRefs(stored.data)) gcCandidates.set(key, ref);
          }
          const values = {
            data: item.data,
            key: item.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: itemStorageId,
          };
          await tx
            .insert(projectionIndexes)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionIndexes.storageId })
            .run();
        }

        for (const item of commit.snapshots ?? []) {
          const itemStorageId = projectionStorageId(commit.scope, item.key);
          const [stored] = await tx
            .select({
              observedAt: projectionSnapshots.observedAt,
              source: projectionSnapshots.source,
            })
            .from(projectionSnapshots)
            .where(eq(projectionSnapshots.storageId, itemStorageId))
            .limit(1);
          if (stored && !shouldReplaceProjectionObservation(stored, item)) continue;
          const values = {
            data: item.data,
            key: item.key,
            observedAt: item.observedAt,
            schemaVersion: PROJECTION_CACHE_SCHEMA_VERSION,
            scope: commit.scope,
            source: item.source,
            storageId: itemStorageId,
          };
          await tx
            .insert(projectionSnapshots)
            .values(values)
            .onConflictDoUpdate({ set: values, target: projectionSnapshots.storageId })
            .run();
        }

        if (gcCandidates.size === 0) return;
        const persistedIndexes = await tx
          .select({ data: projectionIndexes.data })
          .from(projectionIndexes)
          .where(eq(projectionIndexes.scope, commit.scope));
        const retained = new Set<string>();
        for (const { data } of persistedIndexes) {
          for (const key of collectIndexRefs(data).keys()) retained.add(key);
        }

        for (const [key, candidate] of gcCandidates) {
          if (retained.has(key) || committedRecords.has(key)) continue;
          const { table } = PROJECTION_ENTITY_ADAPTERS[candidate.kind];
          await tx
            .delete(table)
            .where(
              and(
                eq(table.scope, commit.scope),
                eq(table.entityId, candidate.id),
                isNull(table.tombstoneAt),
              ),
            )
            .run();
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

    const readRequested = async (
      adapter: ProjectionEntityAdapter,
    ): Promise<DesktopProjectionRecord[]> => {
      const byId = recordsByKind.get(adapter.kind);
      if (!byId || byId.size === 0) return [];
      const ids = [...byId.keys()];
      const rows = await database
        .select()
        .from(adapter.table)
        .where(
          and(
            eq(adapter.table.scope, request.scope),
            eq(adapter.table.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
            adapter.matchIds?.(ids) ?? inArray(adapter.table.entityId, ids),
          ),
        )
        .orderBy(asc(adapter.table.entityId));
      return rows.map((row) => {
        const record = adapter.read(row as never);
        return selectRecordFragments(
          record,
          requestedFragmentsForRecord(adapter.kind, record, byId),
        );
      });
    };

    const indexKeys = request.indexes ?? [];
    const snapshotKeys = request.snapshots ?? [];
    const databaseReadStartedAt = performance.now();
    const [recordGroups, indexRows, snapshotRows] = await Promise.all([
      Promise.all(PROJECTION_ENTITY_ADAPTER_LIST.map(readRequested)),
      indexKeys.length === 0
        ? []
        : database
            .select()
            .from(projectionIndexes)
            .where(
              and(
                eq(projectionIndexes.scope, request.scope),
                eq(projectionIndexes.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
                inArray(projectionIndexes.key, indexKeys),
              ),
            )
            .orderBy(asc(projectionIndexes.key)),
      snapshotKeys.length === 0
        ? []
        : database
            .select()
            .from(projectionSnapshots)
            .where(
              and(
                eq(projectionSnapshots.scope, request.scope),
                eq(projectionSnapshots.schemaVersion, PROJECTION_CACHE_SCHEMA_VERSION),
                inArray(projectionSnapshots.key, snapshotKeys),
              ),
            )
            .orderBy(asc(projectionSnapshots.key)),
    ]);

    return {
      indexes: indexRows
        .map(readIndexRow)
        .filter((index): index is DesktopProjectionIndex => index !== undefined),
      records: recordGroups.flat(),
      snapshots: snapshotRows
        .map(readSnapshotRow)
        .filter((snapshot): snapshot is DesktopProjectionSnapshot => snapshot !== undefined),
      timing: { databaseReadMs: performance.now() - databaseReadStartedAt },
    };
  }

  isCollection(collection: string): boolean {
    return projectionCollections.has(collection);
  }

  async listCollections(): Promise<DesktopLocalDatabaseCollectionInfo[]> {
    const database = this.runtime.db;
    const collections: DesktopLocalDatabaseCollectionInfo[] = [];

    for (const { collection: name, table } of PROJECTION_ENTITY_ADAPTER_LIST) {
      const [row] = await database.select({ entryCount: count() }).from(table);
      collections.push({ entryCount: row?.entryCount ?? 0, name });
    }
    for (const [name, table] of [
      [DESKTOP_PROJECTION_CACHE_TABLES.indexes, projectionIndexes],
      [DESKTOP_PROJECTION_CACHE_TABLES.snapshots, projectionSnapshots],
    ] as const) {
      const [row] = await database.select({ entryCount: count() }).from(table);
      collections.push({ entryCount: row?.entryCount ?? 0, name });
    }

    return collections;
  }

  async inspectEntries(collection: string, prefix: string): Promise<DesktopLocalDatabaseEntry[]> {
    const matchesPrefix = ({ key }: DesktopLocalDatabaseEntry) => key.startsWith(prefix);
    const adapter = PROJECTION_ENTITY_ADAPTER_LIST.find((item) => item.collection === collection);
    if (adapter) {
      const rows = await this.runtime.db
        .select()
        .from(adapter.table)
        .orderBy(asc(adapter.table.storageId));
      return rows
        .map((row) => {
          const scope = row.scope as string;
          const record = adapter.read(row as never);
          return {
            key: projectionStorageId(scope, record.id),
            value: inspectRecord(scope, record),
          };
        })
        .filter(matchesPrefix);
    }

    if (collection === DESKTOP_PROJECTION_CACHE_TABLES.indexes) {
      const rows = await this.runtime.db
        .select()
        .from(projectionIndexes)
        .orderBy(asc(projectionIndexes.storageId));
      return rows
        .flatMap(({ data, key, observedAt, scope, source }) => {
          const index = readIndexRow({ data, key, observedAt, source });
          return index
            ? [{ key: projectionStorageId(scope, key), value: inspectIndex(index) }]
            : [];
        })
        .filter(matchesPrefix);
    }

    if (collection === DESKTOP_PROJECTION_CACHE_TABLES.snapshots) {
      const rows = await this.runtime.db
        .select()
        .from(projectionSnapshots)
        .orderBy(asc(projectionSnapshots.storageId));
      return rows
        .flatMap(({ data, key, observedAt, scope, source }) => {
          const snapshot = readSnapshotRow({ data, key, observedAt, source });
          return snapshot
            ? [{ key: projectionStorageId(scope, key), value: inspectSnapshot(snapshot) }]
            : [];
        })
        .filter(matchesPrefix);
    }

    return [];
  }
}
