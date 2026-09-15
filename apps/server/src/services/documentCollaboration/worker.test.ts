import { describe, expect, it, vi } from 'vitest';

import type {
  CollaborationRoomPersistenceEvent,
  DocumentPersistenceRepository,
  DocumentPersistenceResult,
  DocumentPersistenceVersion,
} from './persistence';
import {
  createDocumentCollaborationPersistenceWorker,
  DOCUMENT_COLLABORATION_PRINCIPAL_INVALID,
} from './worker';

const event = (
  input: {
    clientKind?: 'agent' | 'browser';
    documentId?: string;
    requestId?: string | null;
    roomId?: string;
    userId?: string;
    workspaceId?: string | null;
  } = {},
): CollaborationRoomPersistenceEvent => {
  const documentId = input.documentId ?? 'document-1';
  const roomId = input.roomId ?? documentId;
  const clientKind = input.clientKind ?? 'agent';
  const requestId =
    input.requestId === undefined ? (clientKind === 'agent' ? 'request-1' : null) : input.requestId;
  return {
    documentId,
    messageIds: ['message-1'],
    principal: {
      authoritative: true,
      clientKind,
      documentId,
      requestId,
      roomId,
      userId: input.userId ?? 'user-1',
      workspaceId: input.workspaceId ?? 'workspace-1',
    },
    requestIds: requestId ? [requestId] : [],
    revision: 1,
    roomId,
    snapshot: {
      stateVector: new Uint8Array([1]),
      update: new Uint8Array([2]),
    },
    updateBytes: 1,
    updatedAt: Date.now(),
  };
};

describe('createDocumentCollaborationPersistenceWorker', () => {
  it('isolates two users/workspaces and can persist them concurrently', async () => {
    const scopes: Array<{ documentId: string; userId: string; workspaceId: string | null }> = [];
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const worker = createDocumentCollaborationPersistenceWorker(undefined as never, {
      serviceFactory: (scope) => {
        scopes.push(scope);
        return {
          persist: vi.fn(
            (nextEvent: CollaborationRoomPersistenceEvent): Promise<DocumentPersistenceResult> =>
              new Promise<DocumentPersistenceResult>((resolve) => {
                started.push(nextEvent.documentId);
                releases.set(nextEvent.documentId, () =>
                  resolve({
                    persisted: true,
                    reason: 'persisted',
                    revision: nextEvent.revision,
                    stateVector: 'AQ==',
                  }),
                );
              }),
          ),
        };
      },
    });

    const first = worker.onRoomUpdate(
      event({ documentId: 'document-1', userId: 'user-1', workspaceId: 'workspace-1' }),
    );
    const second = worker.onRoomUpdate(
      event({
        documentId: 'document-2',
        requestId: 'request-2',
        userId: 'user-2',
        workspaceId: 'workspace-2',
      }),
    );
    await vi.waitFor(() => expect(started).toHaveLength(2));
    releases.get('document-1')?.();
    releases.get('document-2')?.();
    await Promise.all([first, second]);

    expect(scopes).toEqual([
      { documentId: 'document-1', userId: 'user-1', workspaceId: 'workspace-1' },
      { documentId: 'document-2', userId: 'user-2', workspaceId: 'workspace-2' },
    ]);
    expect(worker.getCachedServiceCount()).toBe(2);
  });

  it('rejects missing, client-reported, or mismatched principals before creating a service', async () => {
    const serviceFactory = vi.fn();
    const worker = createDocumentCollaborationPersistenceWorker(undefined as never, {
      serviceFactory,
    });
    const missing = event();
    missing.principal = null;
    const clientReported = event();
    clientReported.principal = { ...clientReported.principal, authoritative: false };
    const mismatched = event();
    mismatched.principal = { ...mismatched.principal, documentId: 'another-document' };
    const browserWithRequest = event({ clientKind: 'browser', requestId: 'client-request' });

    for (const invalid of [missing, clientReported, mismatched, browserWithRequest]) {
      await expect(worker.onRoomUpdate(invalid)).rejects.toThrow(
        DOCUMENT_COLLABORATION_PRINCIPAL_INVALID,
      );
    }
    expect(serviceFactory).not.toHaveBeenCalled();
  });

  it('attributes Agent history to llm_call/requestId and browser history to autosave', async () => {
    const calls: Array<Parameters<DocumentPersistenceRepository['compareAndSet']>[0]> = [];
    let version: DocumentPersistenceVersion = {
      documentUpdatedAt: 1,
      revision: 0,
      stateVector: '',
      token: 'v0',
    };
    const repository: DocumentPersistenceRepository = {
      compareAndSet: vi.fn<DocumentPersistenceRepository['compareAndSet']>(async (input) => {
        calls.push(input);
        version = {
          documentUpdatedAt: (version.documentUpdatedAt ?? 0) + 1,
          revision: input.next.revision,
          roomId: input.next.roomId,
          stateVector: input.next.stateVector,
          token: `v${input.next.revision}`,
        };
        return { status: 'persisted', version };
      }),
      readVersion: vi.fn(async () => version),
    };
    const worker = createDocumentCollaborationPersistenceWorker(undefined as never, {
      exporter: {
        exportProjection: vi.fn(async ({ revision }) => ({
          editorData: { revision },
          markdown: `revision-${revision}`,
        })),
      },
      repositoryFactory: () => repository,
    });

    const firstEvent = event();
    firstEvent.requestIds = ['request-1', 'request-2'];
    await worker.onRoomUpdate(firstEvent);
    await worker.onRoomUpdate({
      ...event({ clientKind: 'browser', requestId: null }),
      revision: 2,
      snapshot: {
        stateVector: new Uint8Array([2]),
        update: new Uint8Array([3]),
      },
    });

    expect(calls.map(({ history }) => history)).toEqual([
      {
        idempotencyKey: 'agent_collaboration:request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      {
        idempotencyKey: expect.stringContaining('collaboration:document-1:2:'),
        requestId: null,
        saveSource: 'autosave',
        source: 'collaboration',
      },
    ]);
    expect(calls[0]?.additionalHistories).toEqual([
      {
        idempotencyKey: 'agent_collaboration:request-2',
        requestId: 'request-2',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
    ]);
  });

  it('keeps the cache bounded and evicts only idle scoped services', async () => {
    let clock = 1;
    const worker = createDocumentCollaborationPersistenceWorker(undefined as never, {
      maxCachedServices: 1,
      now: () => clock,
      serviceFactory: () => ({
        persist: vi.fn(
          async (
            nextEvent: CollaborationRoomPersistenceEvent,
          ): Promise<DocumentPersistenceResult> => ({
            persisted: true,
            reason: 'persisted',
            revision: nextEvent.revision,
            stateVector: 'AQ==',
          }),
        ),
      }),
    });

    await worker.onRoomUpdate(event({ documentId: 'document-1' }));
    clock += 1;
    await worker.onRoomUpdate(
      event({ documentId: 'document-2', requestId: 'request-2', userId: 'user-2' }),
    );
    expect(worker.getCachedServiceCount()).toBe(1);
  });
});
