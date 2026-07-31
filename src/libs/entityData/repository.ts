import { localDatabase, type LocalDatabaseBatchOperation } from '@/libs/localDatabase';

export const ENTITY_DATA_SCHEMA_VERSION = 1;

export const ENTITY_DATA_COLLECTIONS = {
  entities: 'entity-records',
  indexes: 'entity-indexes',
  meta: 'entity-meta',
  snapshots: 'entity-snapshots',
} as const;

interface PersistedEnvelope<T> {
  schemaVersion: typeof ENTITY_DATA_SCHEMA_VERSION;
  value: T;
}

interface PersistedEntityIdentity {
  id: string;
  kind: string;
}

interface PersistedNamedValue {
  key: string;
}

export interface EntityDataRepositoryCommit<
  TEntity extends PersistedEntityIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  entities?: TEntity[];
  indexes?: TIndex[];
  snapshots?: TSnapshot[];
}

export interface HydratedEntityData<
  TEntity extends PersistedEntityIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  entities: TEntity[];
  indexes: TIndex[];
  snapshots: TSnapshot[];
}

interface EntityDataRepositoryOptions<
  TEntity extends PersistedEntityIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  isEntity: (value: unknown) => value is TEntity;
  isIndex: (value: unknown) => value is TIndex;
  isSnapshot: (value: unknown) => value is TSnapshot;
}

const encode = (value: string): string => encodeURIComponent(value);
const scopePrefix = (scope: string): string => `${encode(scope)}::`;

export const entityDataStorageKeys = {
  entity: (scope: string, kind: string, id: string): string =>
    `${scopePrefix(scope)}${encode(kind)}::${encode(id)}`,
  index: (scope: string, key: string): string => `${scopePrefix(scope)}${encode(key)}`,
  scopePrefix,
  snapshot: (scope: string, key: string): string => `${scopePrefix(scope)}${encode(key)}`,
};

const envelope = <T>(value: T): PersistedEnvelope<T> => ({
  schemaVersion: ENTITY_DATA_SCHEMA_VERSION,
  value,
});

const readEnvelope = <T>(raw: unknown, validate: (value: unknown) => value is T): T | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const candidate = raw as Partial<PersistedEnvelope<unknown>>;
  if (candidate.schemaVersion !== ENTITY_DATA_SCHEMA_VERSION) return undefined;
  return validate(candidate.value) ? candidate.value : undefined;
};

/**
 * Runtime-neutral, typed persistence boundary for an entity graph.
 *
 * The repository understands scope, record/index/snapshot namespaces and
 * schema envelopes. Domain-specific validators retain ownership of the value
 * shapes; no request or SWR key semantics enter this layer.
 */
export const createEntityDataRepository = <
  TEntity extends PersistedEntityIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
>({
  isEntity,
  isIndex,
  isSnapshot,
}: EntityDataRepositoryOptions<TEntity, TIndex, TSnapshot>) => {
  const commitsInFlight = new Map<string, Promise<void>>();

  const runInOrder = async (scope: string, operation: () => Promise<void>): Promise<void> => {
    const previous = commitsInFlight.get(scope) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    commitsInFlight.set(scope, current);

    try {
      await current;
    } finally {
      if (commitsInFlight.get(scope) === current) commitsInFlight.delete(scope);
    }
  };

  return {
    clearScope: async (scope: string): Promise<void> => {
      const prefix = scopePrefix(scope);
      await runInOrder(scope, async () => {
        await Promise.all([
          localDatabase.deleteByPrefix(ENTITY_DATA_COLLECTIONS.entities, prefix),
          localDatabase.deleteByPrefix(ENTITY_DATA_COLLECTIONS.indexes, prefix),
          localDatabase.deleteByPrefix(ENTITY_DATA_COLLECTIONS.snapshots, prefix),
          localDatabase.delete(ENTITY_DATA_COLLECTIONS.meta, encode(scope)),
        ]);
      });
    },

    commit: async (
      scope: string,
      commit: EntityDataRepositoryCommit<TEntity, TIndex, TSnapshot>,
    ): Promise<void> => {
      const operations: LocalDatabaseBatchOperation[] = [];

      for (const entity of commit.entities ?? []) {
        operations.push({
          collection: ENTITY_DATA_COLLECTIONS.entities,
          key: entityDataStorageKeys.entity(scope, entity.kind, entity.id),
          type: 'set',
          value: envelope(entity),
        });
      }

      for (const index of commit.indexes ?? []) {
        operations.push({
          collection: ENTITY_DATA_COLLECTIONS.indexes,
          key: entityDataStorageKeys.index(scope, index.key),
          type: 'set',
          value: envelope(index),
        });
      }

      for (const snapshot of commit.snapshots ?? []) {
        operations.push({
          collection: ENTITY_DATA_COLLECTIONS.snapshots,
          key: entityDataStorageKeys.snapshot(scope, snapshot.key),
          type: 'set',
          value: envelope(snapshot),
        });
      }

      if (operations.length > 0) {
        await runInOrder(scope, () => localDatabase.batch(operations));
      }
    },

    hydrateScope: async (
      scope: string,
    ): Promise<HydratedEntityData<TEntity, TIndex, TSnapshot>> => {
      const prefix = scopePrefix(scope);
      const [entityEntries, indexEntries, snapshotEntries] = await Promise.all([
        localDatabase.entriesByPrefix<unknown>(ENTITY_DATA_COLLECTIONS.entities, prefix),
        localDatabase.entriesByPrefix<unknown>(ENTITY_DATA_COLLECTIONS.indexes, prefix),
        localDatabase.entriesByPrefix<unknown>(ENTITY_DATA_COLLECTIONS.snapshots, prefix),
      ]);

      return {
        entities: entityEntries
          .map(({ value }) => readEnvelope(value, isEntity))
          .filter((value): value is TEntity => value !== undefined),
        indexes: indexEntries
          .map(({ value }) => readEnvelope(value, isIndex))
          .filter((value): value is TIndex => value !== undefined),
        snapshots: snapshotEntries
          .map(({ value }) => readEnvelope(value, isSnapshot))
          .filter((value): value is TSnapshot => value !== undefined),
      };
    },
  };
};
