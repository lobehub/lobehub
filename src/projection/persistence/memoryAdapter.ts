import type { ProjectionIndex, ProjectionRecord, ProjectionSnapshot } from '@lobechat/types';

import type {
  HydratedProjection,
  MaterializedProjectionCommit,
  ProjectionPersistence,
} from './types';

const emptyHydration = (): HydratedProjection => ({ indexes: [], records: [], snapshots: [] });
const clone = <T>(value: T): T => structuredClone(value);

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
    hydrateScope: async (scope) => clone(scopes.get(scope) ?? emptyHydration()),
  };
};
