import { localDatabase, type LocalDatabaseBatchOperation } from '@/libs/localDatabase';

export const PROJECTION_SCHEMA_VERSION = 1;

export const PROJECTION_COLLECTIONS = {
  records: 'entity-records',
  indexes: 'entity-indexes',
  meta: 'entity-meta',
  snapshots: 'entity-snapshots',
} as const;

interface PersistedEnvelope<T> {
  schemaVersion: typeof PROJECTION_SCHEMA_VERSION;
  value: T;
}

interface PersistedProjectionIdentity {
  id: string;
  kind: string;
}

interface PersistedNamedValue {
  key: string;
}

export interface ProjectionRepositoryCommit<
  TRecord extends PersistedProjectionIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  indexes?: TIndex[];
  records?: TRecord[];
  snapshots?: TSnapshot[];
}

export interface HydratedProjection<
  TRecord extends PersistedProjectionIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  indexes: TIndex[];
  records: TRecord[];
  snapshots: TSnapshot[];
}

interface ProjectionRepositoryOptions<
  TRecord extends PersistedProjectionIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
> {
  isIndex: (value: unknown) => value is TIndex;
  isRecord: (value: unknown) => value is TRecord;
  isSnapshot: (value: unknown) => value is TSnapshot;
}

const encode = (value: string): string => encodeURIComponent(value);
const decode = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};
const scopePrefix = (scope: string): string => `${encode(scope)}::`;

export interface ProjectionStorageIdentity {
  id: string;
  kind: string;
  scope: string;
}

export const projectionStorageKeys = {
  record: (scope: string, kind: string, id: string): string =>
    `${scopePrefix(scope)}${encode(kind)}::${encode(id)}`,
  index: (scope: string, key: string): string => `${scopePrefix(scope)}${encode(key)}`,
  scopePrefix,
  snapshot: (scope: string, key: string): string => `${scopePrefix(scope)}${encode(key)}`,
};

export const parseProjectionStorageKey = (key: string): ProjectionStorageIdentity | undefined => {
  const segments = key.split('::');
  if (segments.length !== 3) return undefined;

  const [encodedScope, encodedKind, encodedId] = segments;
  const scope = decode(encodedScope);
  const kind = decode(encodedKind);
  const id = decode(encodedId);

  if (!scope || !kind || !id) return undefined;
  return { id, kind, scope };
};

const envelope = <T>(value: T): PersistedEnvelope<T> => ({
  schemaVersion: PROJECTION_SCHEMA_VERSION,
  value,
});

const readEnvelope = <T>(raw: unknown, validate: (value: unknown) => value is T): T | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const candidate = raw as Partial<PersistedEnvelope<unknown>>;
  if (candidate.schemaVersion !== PROJECTION_SCHEMA_VERSION) return undefined;
  return validate(candidate.value) ? candidate.value : undefined;
};

/**
 * Runtime-neutral, typed persistence boundary for a partial projection graph.
 *
 * The repository understands scope, record/index/snapshot namespaces and
 * schema envelopes. Domain-specific validators retain ownership of the value
 * shapes; no request or SWR key semantics enter this layer.
 */
export const createProjectionRepository = <
  TRecord extends PersistedProjectionIdentity,
  TIndex extends PersistedNamedValue,
  TSnapshot extends PersistedNamedValue,
>({
  isRecord,
  isIndex,
  isSnapshot,
}: ProjectionRepositoryOptions<TRecord, TIndex, TSnapshot>) => {
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
          localDatabase.deleteByPrefix(PROJECTION_COLLECTIONS.records, prefix),
          localDatabase.deleteByPrefix(PROJECTION_COLLECTIONS.indexes, prefix),
          localDatabase.deleteByPrefix(PROJECTION_COLLECTIONS.snapshots, prefix),
          localDatabase.delete(PROJECTION_COLLECTIONS.meta, encode(scope)),
        ]);
      });
    },

    commit: async (
      scope: string,
      commit: ProjectionRepositoryCommit<TRecord, TIndex, TSnapshot>,
    ): Promise<void> => {
      const operations: LocalDatabaseBatchOperation[] = [];

      for (const record of commit.records ?? []) {
        operations.push({
          collection: PROJECTION_COLLECTIONS.records,
          key: projectionStorageKeys.record(scope, record.kind, record.id),
          type: 'set',
          value: envelope(record),
        });
      }

      for (const index of commit.indexes ?? []) {
        operations.push({
          collection: PROJECTION_COLLECTIONS.indexes,
          key: projectionStorageKeys.index(scope, index.key),
          type: 'set',
          value: envelope(index),
        });
      }

      for (const snapshot of commit.snapshots ?? []) {
        operations.push({
          collection: PROJECTION_COLLECTIONS.snapshots,
          key: projectionStorageKeys.snapshot(scope, snapshot.key),
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
    ): Promise<HydratedProjection<TRecord, TIndex, TSnapshot>> => {
      const prefix = scopePrefix(scope);
      const [recordEntries, indexEntries, snapshotEntries] = await Promise.all([
        localDatabase.entriesByPrefix<unknown>(PROJECTION_COLLECTIONS.records, prefix),
        localDatabase.entriesByPrefix<unknown>(PROJECTION_COLLECTIONS.indexes, prefix),
        localDatabase.entriesByPrefix<unknown>(PROJECTION_COLLECTIONS.snapshots, prefix),
      ]);

      return {
        records: recordEntries
          .map(({ value }) => readEnvelope(value, isRecord))
          .filter((value): value is TRecord => value !== undefined),
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
