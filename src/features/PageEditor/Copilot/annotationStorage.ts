'use client';

import {
  type AnnotationMutation,
  type AnnotationRecord,
  type AnnotationService,
  IAnnotationService,
  type IEditor,
} from '@lobehub/editor';
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import useSWR from 'swr';

import { useSingleton } from '@/hooks/useSingleton';
import { lambdaClient } from '@/libs/trpc/client';

/**
 * The wire shape returned by the page annotation router. `version` and
 * `documentId` are transport metadata and are intentionally not put into the
 * editor's AnnotationRecord cache.
 */
export interface PageAnnotationWireRecord {
  author?: unknown;
  createdAt?: Date | string;
  documentId?: string;
  id: string;
  kind?: string;
  nodeKeys?: string[];
  payload?: unknown;
  quotedText?: string;
  status?: AnnotationRecord['status'] | 'deleted';
  updatedAt?: Date | string;
  version?: number;
}

export interface PageAnnotationRecordPatch {
  author?: unknown;
  kind?: string;
  nodeKeys?: string[];
  payload?: unknown;
  quotedText?: string;
  status?: AnnotationRecord['status'] | 'deleted';
}

export interface PageAnnotationMutationInput {
  documentId: string;
  expectedVersion?: number;
  id: string;
  patch?: PageAnnotationRecordPatch;
  record?: PageAnnotationWireRecord;
}

export interface PageAnnotationStorageClient {
  bulkUpsertLegacy: (input: {
    documentId: string;
    records: PageAnnotationWireRecord[];
  }) => Promise<unknown>;
  create: (input: { documentId: string; record: PageAnnotationWireRecord }) => Promise<unknown>;
  listByDocument: (input: {
    documentId: string;
    includeDeleted?: boolean;
  }) => Promise<readonly PageAnnotationWireRecord[]>;
  remove: (input: { documentId: string; expectedVersion?: number; id: string }) => Promise<unknown>;
  update: (input: {
    documentId: string;
    expectedVersion?: number;
    id: string;
    patch: PageAnnotationRecordPatch;
  }) => Promise<unknown>;
}

const pageAnnotationStorageClient: PageAnnotationStorageClient = {
  bulkUpsertLegacy: (input) =>
    lambdaClient.documentAnnotation.bulkUpsertLegacy.mutate(
      input as Parameters<typeof lambdaClient.documentAnnotation.bulkUpsertLegacy.mutate>[0],
    ),
  create: (input) =>
    lambdaClient.documentAnnotation.create.mutate(
      input as Parameters<typeof lambdaClient.documentAnnotation.create.mutate>[0],
    ),
  listByDocument: (input) => lambdaClient.documentAnnotation.listByDocument.query(input),
  remove: (input) =>
    lambdaClient.documentAnnotation.softDelete.mutate(
      input as Parameters<typeof lambdaClient.documentAnnotation.softDelete.mutate>[0],
    ),
  update: (input) =>
    lambdaClient.documentAnnotation.update.mutate(
      input as Parameters<typeof lambdaClient.documentAnnotation.update.mutate>[0],
    ),
};

const isAnnotationStatus = (value: unknown): value is AnnotationRecord['status'] =>
  value === 'active' || value === 'resolved' || value === 'orphaned';

const toISOString = (value: Date | string | undefined, fallback = new Date()): string => {
  const date = value instanceof Date ? value : value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
};

/** Convert a DB row into the editor's backwards-compatible record shape. */
export const toEditorAnnotationRecord = (
  value: PageAnnotationWireRecord | null | undefined,
): AnnotationRecord | null => {
  if (!value || typeof value.id !== 'string' || value.id.length === 0) return null;
  if (value.status === 'deleted') return null;

  const record: AnnotationRecord = {
    createdAt: toISOString(value.createdAt),
    id: value.id,
    kind: typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'comment',
    payload: (value.payload ?? null) as AnnotationRecord['payload'],
    quotedText: typeof value.quotedText === 'string' ? value.quotedText : '',
    status: isAnnotationStatus(value.status) ? value.status : 'active',
    updatedAt: toISOString(
      value.updatedAt,
      value.createdAt ? new Date(value.createdAt) : new Date(),
    ),
  };

  if (value.author !== undefined) record.author = value.author as AnnotationRecord['author'];
  return record;
};

/** Convert an editor record into the DB router's wire shape. */
export const toPageAnnotationWireRecord = (record: AnnotationRecord): PageAnnotationWireRecord => ({
  author: record.author,
  createdAt: record.createdAt,
  id: record.id,
  kind: record.kind,
  payload: record.payload,
  quotedText: record.quotedText,
  status: record.status,
  updatedAt: record.updatedAt,
});

/**
 * Merge DB rows over a legacy/Yjs fallback snapshot. Deleted DB rows remove a
 * fallback row, while a missing DB row remains visible until migration has
 * completed successfully. This prevents a transient DB failure from making
 * old collaborative comments disappear.
 */
export const mergePageAnnotationRecords = (
  databaseRecords: readonly PageAnnotationWireRecord[],
  fallbackRecords: readonly AnnotationRecord[] = [],
): AnnotationRecord[] => {
  const merged = new Map<string, AnnotationRecord>();
  for (const record of fallbackRecords) merged.set(record.id, record);

  for (const databaseRecord of databaseRecords) {
    if (databaseRecord.status === 'deleted') {
      merged.delete(databaseRecord.id);
      continue;
    }
    const record = toEditorAnnotationRecord(databaseRecord);
    if (record) merged.set(record.id, record);
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
};

export const isPersistableLocalAnnotationMutation = (
  mutation: Pick<AnnotationMutation, 'source' | 'type'>,
): boolean => mutation.source === 'local' && ['create', 'update', 'remove'].includes(mutation.type);

const mutationId = (mutation: AnnotationMutation): string | undefined =>
  mutation.id ?? mutation.record?.id;

const responseRecord = (value: unknown): PageAnnotationWireRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { annotation?: unknown; record?: unknown };
  const record = candidate.record ?? candidate.annotation;
  return record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string'
    ? (record as PageAnnotationWireRecord)
    : null;
};

const responseRecords = (value: unknown): PageAnnotationWireRecord[] => {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as { annotations?: unknown; records?: unknown };
  const records = candidate.records ?? candidate.annotations;
  return Array.isArray(records)
    ? records.filter((record): record is PageAnnotationWireRecord =>
        Boolean(record && typeof record === 'object' && typeof record.id === 'string'),
      )
    : [];
};

const patchFromRecord = (record: AnnotationRecord): PageAnnotationRecordPatch => ({
  author: record.author,
  kind: record.kind,
  payload: record.payload,
  quotedText: record.quotedText,
  status: record.status,
});

/** Persist one editor mutation through the version-aware page API. */
export const persistPageAnnotationMutation = async ({
  client,
  documentId,
  mutation,
  versions,
}: {
  client: PageAnnotationStorageClient;
  documentId: string;
  mutation: AnnotationMutation;
  versions: Map<string, number>;
}): Promise<unknown> => {
  if (!isPersistableLocalAnnotationMutation(mutation)) return null;

  const id = mutationId(mutation);
  if (!id) return null;
  const expectedVersion = versions.get(id);

  if (mutation.type === 'remove') {
    const result = await client.remove({ documentId, expectedVersion, id });
    const persisted = responseRecord(result);
    if (typeof persisted?.version === 'number') versions.set(id, persisted.version);
    return result;
  }

  if (!mutation.record) return null;
  if (mutation.type === 'create') {
    const result = await client.create({
      documentId,
      record: toPageAnnotationWireRecord(mutation.record),
    });
    const persisted = responseRecord(result);
    if (typeof persisted?.version === 'number') versions.set(id, persisted.version);
    return result;
  }

  const result = await client.update({
    documentId,
    expectedVersion,
    id,
    patch: patchFromRecord(mutation.record),
  });
  const persisted = responseRecord(result);
  if (typeof persisted?.version === 'number') versions.set(id, persisted.version);
  return result;
};

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export interface UsePageAnnotationStorageOptions {
  client?: PageAnnotationStorageClient;
  documentId?: string;
  editor?: IEditor;
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UsePageAnnotationStorageResult {
  error: Error | null;
  isLoading: boolean;
  isValidating: boolean;
  retry: () => Promise<unknown>;
}

const PageAnnotationStorageContext = createContext<UsePageAnnotationStorageResult>({
  error: null,
  isLoading: false,
  isValidating: false,
  retry: async () => undefined,
});

export interface PageAnnotationStorageProviderProps extends UsePageAnnotationStorageOptions {
  children: ReactNode;
}

/** Keep annotation persistence mounted with the page/editor, not the tab UI. */
export const PageAnnotationStorageProvider = ({
  children,
  ...options
}: PageAnnotationStorageProviderProps) => {
  const value = usePageAnnotationStorage(options);
  return createElement(PageAnnotationStorageContext.Provider, { value }, children);
};

export const usePageAnnotationStorageContext = (): UsePageAnnotationStorageResult =>
  useContext(PageAnnotationStorageContext);

/**
 * Bridges the editor's external AnnotationService to page DB persistence.
 * The service remains the optimistic local cache; only DB rows are imported
 * with a non-local source, so imports/revalidation never echo back as writes.
 */
export const usePageAnnotationStorage = ({
  client = pageAnnotationStorageClient,
  documentId,
  editor,
  enabled = true,
  refreshInterval = 30_000,
}: UsePageAnnotationStorageOptions): UsePageAnnotationStorageResult => {
  const serviceRef = useRef<AnnotationService | null>(null);
  const versions = useSingleton(() => new Map<string, number>());
  const fallback = useSingleton(() => new Map<string, AnnotationRecord>());
  const optimistic = useSingleton(() => new Map<string, AnnotationRecord | null>());
  const optimisticPending = useSingleton(() => new Set<string>());
  const optimisticVersion = useSingleton(() => new Map<string, number>());
  const migrationPromiseRef = useRef<Promise<boolean> | null>(null);
  const migrationStateRef = useRef<'idle' | 'done' | 'failed'>('idle');
  const queue = useSingleton(() => new Map<string, Promise<void>>());
  const failed = useSingleton(() => new Map<string, AnnotationMutation>());
  const scopeGenerationRef = useRef(0);
  const scopeRef = useRef(0);
  const mountedRef = useRef(true);
  const enqueueMutationRef = useRef<((mutation: AnnotationMutation) => void) | null>(null);
  const revalidateRef = useRef<(() => Promise<unknown>) | null>(null);
  const [serviceReady, setServiceReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);

  const migrateLegacy = useCallback(
    async (records: readonly AnnotationRecord[]): Promise<boolean> => {
      if (!documentId || records.length === 0) {
        migrationStateRef.current = 'done';
        return true;
      }
      if (migrationStateRef.current === 'done') return true;
      if (migrationPromiseRef.current) return migrationPromiseRef.current;

      const scope = scopeRef.current;
      const payload = records.map(toPageAnnotationWireRecord);
      const migration = client
        .bulkUpsertLegacy({ documentId, records: payload })
        .then((result) => {
          if (scopeRef.current !== scope) return false;
          for (const record of responseRecords(result)) {
            if (typeof record.version === 'number') versions.set(record.id, record.version);
          }
          fallback.clear();
          migrationStateRef.current = 'done';
          return true;
        })
        .catch((error) => {
          if (scopeRef.current === scope) {
            migrationStateRef.current = 'failed';
            setPersistenceError(toError(error));
          }
          return false;
        });
      migrationPromiseRef.current = migration;
      void migration.finally(() => {
        if (migrationPromiseRef.current === migration) migrationPromiseRef.current = null;
      });
      return migration;
    },
    [client, documentId],
  );

  const loadAnnotations = useCallback(async (): Promise<readonly PageAnnotationWireRecord[]> => {
    const scope = scopeRef.current;
    const service = serviceRef.current;
    const databaseRecords = await client.listByDocument({
      documentId: documentId!,
      includeDeleted: true,
    });
    if (scopeRef.current !== scope) return [];
    const legacy = [...fallback.values()];
    if (!service || legacy.length === 0) {
      return databaseRecords;
    }

    // Never send a legacy row back through the migration endpoint when a DB
    // row already exists (including a deleted tombstone). The DB is the
    // authority; Yjs only fills genuinely missing records.
    const knownIds = new Set(databaseRecords.map((record) => record.id));
    const missingLegacy = legacy.filter((record) => !knownIds.has(record.id));
    if (missingLegacy.length === 0) {
      fallback.clear();
      migrationStateRef.current = 'done';
      return databaseRecords;
    }

    const migrated = await migrateLegacy(missingLegacy);
    if (!migrated) return databaseRecords;
    const refreshedRecords = await client.listByDocument({
      documentId: documentId!,
      includeDeleted: true,
    });
    return scopeRef.current === scope ? refreshedRecords : [];
  }, [client, documentId, migrateLegacy]);

  const [readyDocumentId, setReadyDocumentId] = useState<string | undefined>();
  useEffect(() => {
    mountedRef.current = true;
    const nextScope = ++scopeGenerationRef.current;
    scopeRef.current = nextScope;
    serviceRef.current = null;
    versions.clear();
    fallback.clear();
    optimistic.clear();
    optimisticPending.clear();
    optimisticVersion.clear();
    migrationPromiseRef.current = null;
    migrationStateRef.current = 'idle';
    queue.clear();
    failed.clear();
    setPersistenceError(null);
    setServiceReady(false);
    setReadyDocumentId(undefined);

    if (!enabled || !documentId || !editor) {
      return () => {
        mountedRef.current = false;
      };
    }

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const getService = () => {
      if (disposed) return;
      const service = editor.requireService(IAnnotationService) as AnnotationService | null;
      if (!service) {
        retryTimer = setTimeout(getService, 100);
        return;
      }

      service.setStorageMode('external');
      serviceRef.current = service;
      for (const record of service.getAll()) fallback.set(record.id, record);

      const enqueue = (mutation: AnnotationMutation) => {
        if (!isPersistableLocalAnnotationMutation(mutation)) return;
        const id = mutationId(mutation);
        if (!id) return;

        if (mutation.type === 'remove') optimistic.set(id, null);
        else if (mutation.record) optimistic.set(id, mutation.record);
        optimisticPending.add(id);

        const previous = queue.get(id) ?? Promise.resolve();
        const mutationScope = nextScope;
        const task = previous
          .catch(() => undefined)
          .then(async () => {
            if (scopeRef.current !== mutationScope) return;
            try {
              const responseVersions = new Map(versions);
              const result = await persistPageAnnotationMutation({
                client,
                documentId,
                mutation,
                versions: responseVersions,
              });
              if (scopeRef.current !== mutationScope) return;
              versions.clear();
              for (const [versionId, version] of responseVersions) {
                versions.set(versionId, version);
              }
              const persisted = responseRecord(result);
              if (typeof persisted?.version === 'number') {
                optimisticVersion.set(id, persisted.version);
              }
              optimisticPending.delete(id);
              failed.delete(id);
              if (mountedRef.current) setPersistenceError(null);
              // Revalidate after the server has acknowledged the mutation;
              // otherwise a stale poll could replace/clear the optimistic row.
              void revalidateRef.current?.();
            } catch (error) {
              if (scopeRef.current === mutationScope) {
                failed.set(id, mutation);
                if (mountedRef.current) setPersistenceError(toError(error));
              }
            }
          });
        queue.set(id, task);
        void task.finally(() => {
          if (queue.get(id) === task) queue.delete(id);
        });
      };

      unsubscribe = service.subscribeMutations((mutation) => {
        if (disposed) return;
        if (mutation.type === 'migration' || mutation.source === 'migration') {
          const records = mutation.records ?? service.getAll();
          for (const record of records) fallback.set(record.id, record);
          // Let the next SWR load compare legacy ids with the DB first. Calling
          // bulkUpsert directly here could overwrite an existing DB row before
          // the DB-priority check has had a chance to run.
          return;
        }
        if (mutation.source === 'local') enqueue(mutation);
      });
      enqueueMutationRef.current = enqueue;

      setReadyDocumentId(documentId);
      setServiceReady(true);
    };

    getService();
    return () => {
      disposed = true;
      mountedRef.current = false;
      enqueueMutationRef.current = null;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [client, documentId, editor, enabled, migrateLegacy]);

  const swrKey =
    serviceReady && readyDocumentId ? ['page-annotation-records', readyDocumentId] : null;
  const swr = useSWR<readonly PageAnnotationWireRecord[]>(swrKey, loadAnnotations, {
    dedupingInterval: 2_000,
    refreshInterval,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  revalidateRef.current = () => swr.mutate();

  useEffect(() => {
    const service = serviceRef.current;
    if (!service || !swr.data || !readyDocumentId) return;

    for (const record of swr.data) {
      if (typeof record.version === 'number') versions.set(record.id, record.version);
    }

    const fallbackRecords = migrationStateRef.current === 'done' ? [] : [...fallback.values()];
    const merged = mergePageAnnotationRecords(swr.data, fallbackRecords);
    for (const [id, optimisticRecord] of optimistic) {
      if (optimisticRecord) merged.push(optimisticRecord);
      else {
        const index = merged.findIndex((record) => record.id === id);
        if (index >= 0) merged.splice(index, 1);
      }
    }
    const deduped = [...new Map(merged.map((record) => [record.id, record])).values()];
    service.importSnapshot(deduped, { replace: true, source: 'import' });

    for (const [id] of optimistic) {
      const persisted = swr.data.find((record) => record.id === id);
      const requiredVersion = optimisticVersion.get(id);
      const hasConfirmedVersion =
        typeof requiredVersion === 'number' &&
        typeof persisted?.version === 'number' &&
        persisted.version >= requiredVersion;
      if (!optimisticPending.has(id) && persisted && hasConfirmedVersion) {
        optimistic.delete(id);
        optimisticVersion.delete(id);
      }
    }
  }, [readyDocumentId, swr.data]);

  const retry = useCallback(async (): Promise<unknown> => {
    setPersistenceError(null);
    const service = serviceRef.current;
    const failedMutations = [...failed.values()];
    failed.clear();
    const enqueue = enqueueMutationRef.current;
    for (const mutation of failedMutations) {
      const id = mutationId(mutation);
      const current = id ? service?.get(id) : null;
      const retryMutation =
        current && mutation.type === 'update' ? { ...mutation, record: current } : mutation;
      if (id) enqueue?.(retryMutation);
    }
    return swr.mutate();
  }, [swr]);

  return {
    error: persistenceError ?? (swr.error ? toError(swr.error) : null),
    isLoading: !serviceReady || (swr.isLoading && !swr.data),
    isValidating: swr.isValidating,
    retry,
  };
};

export { pageAnnotationStorageClient };
