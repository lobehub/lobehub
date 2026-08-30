import type {
  ProjectionHydrationRequest,
  ProjectionIndex,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@lobechat/types';

import type {
  HydratedProjection,
  MaterializedProjectionCommit,
  ProjectionPersistence,
} from './types';

const emptyHydration = (): HydratedProjection => ({ indexes: [], records: [], snapshots: [] });
const clone = <T>(value: T): T => structuredClone(value);

const selectHydration = (
  hydration: HydratedProjection,
  request: ProjectionHydrationRequest,
): HydratedProjection => {
  const indexKeys = new Set<string>(request.indexes ?? []);
  const snapshotKeys = new Set<string>(request.snapshots ?? []);
  const requestedRecords = new Map<string, Set<string>>();
  for (const item of request.records ?? []) {
    for (const id of item.ids) {
      const key = `${item.kind}:${id}`;
      const fragments = requestedRecords.get(key) ?? new Set<string>();
      for (const fragment of item.fragments) fragments.add(fragment);
      requestedRecords.set(key, fragments);
    }
  }

  return {
    indexes: hydration.indexes.filter((item) => indexKeys.has(item.key)).map(clone),
    records: hydration.records.flatMap((record) => {
      const fragments = requestedRecords.get(`${record.kind}:${record.id}`);
      if (!fragments) return [];
      return [
        clone({
          ...record,
          fragments: Object.fromEntries(
            Object.entries(record.fragments).filter(([name]) => fragments.has(name)),
          ),
        } as ProjectionRecord),
      ];
    }),
    snapshots: hydration.snapshots.filter((item) => snapshotKeys.has(item.key)).map(clone),
  };
};

/**
 * Web intentionally keeps Projection cache process-local. Network loading is an
 * acceptable Web fallback; durable entity caching is owned by the desktop adapter.
 */
export const createMemoryProjectionPersistence = (): ProjectionPersistence => {
  const scopes = new Map<string, HydratedProjection>();

  const scopeState = (scope: string): HydratedProjection => {
    const existing = scopes.get(scope);
    if (existing) return existing;

    const created = emptyHydration();
    scopes.set(scope, created);
    return created;
  };

  return {
    clearScope: async (scope) => {
      scopes.delete(scope);
    },
    commit: async (scope: string, commit: MaterializedProjectionCommit) => {
      const current = scopeState(scope);
      const records = new Map(
        current.records.map((record) => [`${record.kind}:${record.id}`, record] as const),
      );
      const indexes = new Map(current.indexes.map((index) => [index.key, index] as const));
      const snapshots = new Map(
        current.snapshots.map((snapshot) => [snapshot.key, snapshot] as const),
      );

      for (const record of commit.records)
        records.set(`${record.kind}:${record.id}`, clone(record));
      for (const index of commit.indexes) indexes.set(index.key, clone(index));
      for (const snapshot of commit.snapshots) snapshots.set(snapshot.key, clone(snapshot));

      scopes.set(scope, {
        indexes: [...indexes.values()] as ProjectionIndex[],
        records: [...records.values()] as ProjectionRecord[],
        snapshots: [...snapshots.values()] as ProjectionSnapshot[],
      });
    },
    hydrate: async (scope, request) =>
      selectHydration(scopes.get(scope) ?? emptyHydration(), request),
  };
};
