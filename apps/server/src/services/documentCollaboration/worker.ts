import type { LobeChatDatabase } from '@/database/type';

import { DatabaseDocumentPersistenceRepository } from './databaseRepository';
import { readOnlyHeadlessExporter } from './headlessExporter';
import {
  type CollaborationRoomPersistenceEvent,
  type DocumentPersistenceRepository,
  type DocumentPersistenceResult,
  DocumentPersistenceService,
  type ReadOnlyHeadlessExporter,
} from './persistence';

export const DOCUMENT_COLLABORATION_PRINCIPAL_INVALID = 'DOCUMENT_COLLABORATION_PRINCIPAL_INVALID';
export const DOCUMENT_COLLABORATION_WORKER_CACHE_FULL = 'DOCUMENT_COLLABORATION_WORKER_CACHE_FULL';

interface AuthoritativeCollaborationPrincipal extends Record<string, unknown> {
  authoritative: true;
  clientKind: 'agent' | 'browser';
  documentId: string;
  requestId: string | null;
  roomId: string;
  userId: string;
  workspaceId: string | null;
}

export interface DocumentCollaborationPersistenceScope {
  documentId: string;
  userId: string;
  workspaceId: string | null;
}

export interface DocumentCollaborationPersistenceWorkerOptions {
  exporter?: ReadOnlyHeadlessExporter;
  idleServiceTtlMs?: number;
  maxCachedServices?: number;
  now?: () => number;
  repositoryFactory?: (
    scope: DocumentCollaborationPersistenceScope,
  ) => DocumentPersistenceRepository;
  serviceFactory?: (
    scope: DocumentCollaborationPersistenceScope,
  ) => Pick<DocumentPersistenceService, 'persist'>;
}

interface CachedPersistenceService {
  inFlight: number;
  lastUsedAt: number;
  service: Pick<DocumentPersistenceService, 'persist'>;
}

const asRequiredString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const invalidPrincipal = (): never => {
  throw new Error(DOCUMENT_COLLABORATION_PRINCIPAL_INVALID);
};

const validatePrincipal = (
  event: CollaborationRoomPersistenceEvent,
): AuthoritativeCollaborationPrincipal => {
  const principal = event.principal;
  if (!principal || principal.authoritative !== true) return invalidPrincipal();

  const userId = asRequiredString(principal.userId);
  const documentId = asRequiredString(principal.documentId);
  const roomId = asRequiredString(principal.roomId);
  const clientKind = principal.clientKind;
  const rawWorkspaceId = principal.workspaceId;
  const workspaceId = rawWorkspaceId === null ? null : asRequiredString(rawWorkspaceId);
  const rawRequestId = principal.requestId;
  const requestId =
    rawRequestId === null || rawRequestId === undefined ? null : asRequiredString(rawRequestId);

  if (
    !userId ||
    !documentId ||
    !roomId ||
    (clientKind !== 'agent' && clientKind !== 'browser') ||
    (rawWorkspaceId !== null && workspaceId === null) ||
    event.documentId !== documentId ||
    event.roomId !== roomId ||
    event.documentId !== event.roomId ||
    (clientKind === 'agent' && !requestId) ||
    (clientKind === 'browser' && requestId !== null)
  ) {
    return invalidPrincipal();
  }

  return {
    ...principal,
    authoritative: true,
    clientKind,
    documentId,
    requestId,
    roomId,
    userId,
    workspaceId,
  };
};

const cacheKeyFor = (scope: DocumentCollaborationPersistenceScope): string =>
  JSON.stringify([scope.userId, scope.workspaceId, scope.documentId]);

/**
 * Scoped composition retained for tests and single-tenant workers. A global
 * collaboration server must use `createDocumentCollaborationPersistenceWorker`
 * so one caller's database scope can never be reused for another principal.
 */
export const createDocumentCollaborationPersistenceService = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string | null,
  options: { exporter?: ReadOnlyHeadlessExporter } = {},
): DocumentPersistenceService =>
  new DocumentPersistenceService({
    exporter: options.exporter ?? readOnlyHeadlessExporter,
    repository: new DatabaseDocumentPersistenceRepository(db, userId, workspaceId),
  });

/**
 * Multi-tenant, fail-closed persistence coordinator for the global room server.
 *
 * It accepts only server-verifier principals, normalizes request attribution,
 * and caches one serialized persistence service per user/workspace/document.
 * Idle entries are removed and the cache never evicts an active service.
 */
export const createDocumentCollaborationPersistenceWorker = (
  db: LobeChatDatabase,
  options: DocumentCollaborationPersistenceWorkerOptions = {},
) => {
  const cache = new Map<string, CachedPersistenceService>();
  const now = options.now ?? Date.now;
  const idleServiceTtlMs = Math.max(1, options.idleServiceTtlMs ?? 30 * 60 * 1000);
  const maxCachedServices = Math.max(1, options.maxCachedServices ?? 1000);

  const prune = (): void => {
    const cutoff = now() - idleServiceTtlMs;
    for (const [key, entry] of cache) {
      if (entry.inFlight === 0 && entry.lastUsedAt <= cutoff) cache.delete(key);
    }
  };

  const makeService = (
    scope: DocumentCollaborationPersistenceScope,
  ): Pick<DocumentPersistenceService, 'persist'> => {
    if (options.serviceFactory) return options.serviceFactory(scope);
    const repository = options.repositoryFactory
      ? options.repositoryFactory(scope)
      : new DatabaseDocumentPersistenceRepository(db, scope.userId, scope.workspaceId);
    return new DocumentPersistenceService({
      exporter: options.exporter ?? readOnlyHeadlessExporter,
      repository,
      resolveHistory: (event) => {
        const principal = validatePrincipal(event);
        return principal.clientKind === 'agent'
          ? {
              requestId: principal.requestId,
              saveSource: 'llm_call',
              source: 'agent_collaboration',
            }
          : { requestId: null, saveSource: 'autosave', source: 'collaboration' };
      },
    });
  };

  const getService = (scope: DocumentCollaborationPersistenceScope): CachedPersistenceService => {
    const key = cacheKeyFor(scope);
    const existing = cache.get(key);
    if (existing) return existing;

    prune();
    while (cache.size >= maxCachedServices) {
      const removable = Array.from(cache.entries())
        .filter(([, entry]) => entry.inFlight === 0)
        .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (!removable) throw new Error(DOCUMENT_COLLABORATION_WORKER_CACHE_FULL);
      cache.delete(removable[0]);
    }

    const entry: CachedPersistenceService = {
      inFlight: 0,
      lastUsedAt: now(),
      service: makeService(scope),
    };
    cache.set(key, entry);
    return entry;
  };

  const onRoomUpdate = async (
    event: CollaborationRoomPersistenceEvent,
  ): Promise<DocumentPersistenceResult> => {
    const principal = validatePrincipal(event);
    const scope: DocumentCollaborationPersistenceScope = {
      documentId: principal.documentId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    };
    const entry = getService(scope);
    entry.inFlight += 1;
    entry.lastUsedAt = now();
    try {
      const requestIds = Array.from(
        new Set(
          [...event.requestIds, principal.requestId].filter(
            (requestId): requestId is string =>
              typeof requestId === 'string' && requestId.length > 0,
          ),
        ),
      );
      return await entry.service.persist({
        ...event,
        documentId: principal.documentId,
        principal,
        requestIds,
        roomId: principal.roomId,
      });
    } finally {
      entry.inFlight -= 1;
      entry.lastUsedAt = now();
      prune();
    }
  };

  return {
    getCachedServiceCount: (): number => cache.size,
    onRoomUpdate,
    prune,
  };
};
