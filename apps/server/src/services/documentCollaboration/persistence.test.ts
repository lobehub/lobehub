import { describe, expect, it, vi } from 'vitest';

import {
  type CollaborationRoomPersistenceEvent,
  type DocumentPersistenceRepository,
  DocumentPersistenceService,
  type DocumentPersistenceVersion,
  type ReadOnlyHeadlessExporter,
} from './persistence';

const event = (overrides: Partial<CollaborationRoomPersistenceEvent> = {}) => ({
  documentId: 'document-1',
  messageIds: ['message-1'],
  principal: { clientKind: 'agent', requestId: 'request-1' },
  requestIds: ['request-1'],
  revision: 1,
  roomId: 'room-1',
  snapshot: {
    stateVector: new Uint8Array([1]),
    update: new Uint8Array([2, 3]),
  },
  updateBytes: 2,
  updatedAt: 1,
  ...overrides,
});

class FakeRepository implements DocumentPersistenceRepository {
  calls: Array<Parameters<DocumentPersistenceRepository['compareAndSet']>[0]> = [];
  historyKeys = new Set<string>();
  nextStatus: 'conflict' | 'duplicate' | 'persisted' = 'persisted';
  readCalls = 0;
  version: DocumentPersistenceVersion = {
    revision: 0,
    snapshotUpdate: null,
    stateVector: '',
    token: 'v0',
  };

  readVersion = async () => {
    this.readCalls += 1;
    return this.version;
  };

  compareAndSet = async (input: Parameters<DocumentPersistenceRepository['compareAndSet']>[0]) => {
    this.calls.push(input);
    if (this.nextStatus === 'conflict') {
      this.nextStatus = 'persisted';
      return { status: 'conflict' as const };
    }
    const duplicateHistory = this.historyKeys.has(input.history.idempotencyKey);
    this.historyKeys.add(input.history.idempotencyKey);
    this.version = {
      roomId: input.next.roomId,
      revision: input.next.revision,
      snapshotUpdate: Buffer.from(input.next.snapshot.update).toString('base64'),
      stateVector: input.next.stateVector,
      token: `v${input.next.revision}`,
    };
    return {
      historyId: duplicateHistory ? undefined : `history-${this.historyKeys.size}`,
      status: this.nextStatus,
      version: this.version,
    };
  };
}

describe('DocumentPersistenceService', () => {
  it('exports an immutable snapshot through a read-only Headless boundary and persists it with CAS', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async ({ readOnly, snapshot }) => {
        expect(readOnly).toBe(true);
        snapshot.update[0] = 99;
        return { editorData: { root: { children: [] } }, markdown: 'room markdown' };
      }),
    };
    const service = new DocumentPersistenceService({ exporter, repository });
    const input = event();

    const result = await service.persist(input);

    expect(result).toMatchObject({ persisted: true, reason: 'persisted', revision: 1 });
    expect(input.snapshot.update).toEqual(new Uint8Array([2, 3]));
    expect(repository.calls[0]).toMatchObject({
      documentId: 'document-1',
      history: {
        idempotencyKey: 'agent_collaboration:request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: { markdown: 'room markdown', revision: 1, stateVector: 'AQ==' },
    });
  });

  it('deduplicates the same room revision and request history without a second export or write', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async () => ({ editorData: {}, markdown: 'same' })),
    };
    const service = new DocumentPersistenceService({ exporter, repository });
    const input = event();

    const first = await service.persist(input);
    const second = await service.persist(event({ messageIds: ['message-2'] }));

    expect(first.reason).toBe('persisted');
    expect(second).toMatchObject({ persisted: false, reason: 'duplicate' });
    expect(exporter.exportProjection).toHaveBeenCalledTimes(1);
    expect(repository.calls).toHaveLength(1);
  });

  it('uses requestId as the stable history idempotency key while allowing a later room revision to update the projection', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi
        .fn()
        .mockResolvedValueOnce({ editorData: { revision: 1 }, markdown: 'one' })
        .mockResolvedValueOnce({ editorData: { revision: 2 }, markdown: 'two' }),
    };
    const service = new DocumentPersistenceService({ exporter, repository });

    await service.persist(event());
    const result = await service.persist(
      event({
        messageIds: ['message-2'],
        revision: 2,
        snapshot: { stateVector: new Uint8Array([2]), update: new Uint8Array([4]) },
      }),
    );

    expect(result.reason).toBe('persisted');
    expect(repository.calls).toHaveLength(2);
    expect(repository.calls.map((call) => call.history.idempotencyKey)).toEqual([
      'agent_collaboration:request-1',
      'agent_collaboration:request-1',
    ]);
    expect(repository.calls[1].expected.token).toBe('v1');
  });

  it('keeps every request id when one debounced room snapshot contains several Agent writes', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async () => ({ editorData: {}, markdown: 'coalesced' })),
    };
    const service = new DocumentPersistenceService({ exporter, repository });

    await service.persist(
      event({
        principal: { clientKind: 'agent', requestId: 'request-3' },
        requestIds: ['request-1', 'request-2', 'request-3'],
      }),
    );

    expect(repository.calls[0]?.history.requestId).toBe('request-1');
    expect(repository.calls[0]?.additionalHistories).toEqual([
      expect.objectContaining({
        requestId: 'request-2',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      }),
      expect.objectContaining({
        requestId: 'request-3',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      }),
    ]);
  });

  it('surfaces CAS conflicts, forgets the stale version, and re-reads before the next attempt', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async () => ({ editorData: {}, markdown: 'retry' })),
    };
    const service = new DocumentPersistenceService({ exporter, repository });
    repository.nextStatus = 'conflict';

    const conflict = await service.persist(event());
    expect(conflict).toMatchObject({ persisted: false, reason: 'cas-conflict' });
    repository.version = { revision: 7, stateVector: 'Bw==', token: 'external-v7' };
    const retry = await service.persist(
      event({
        revision: 2,
        snapshot: { stateVector: new Uint8Array([2]), update: new Uint8Array([4]) },
      }),
    );

    expect(retry.reason).toBe('persisted');
    expect(repository.readCalls).toBe(2);
    expect(repository.calls[1].expected.token).toBe('external-v7');
  });

  it('shares one in-flight write for concurrent duplicate events', async () => {
    const repository = new FakeRepository();
    let release!: () => void;
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(
        () =>
          new Promise<{ editorData: Record<string, unknown>; markdown: string }>(
            (resolve) => (release = () => resolve({ editorData: {}, markdown: 'once' })),
          ),
      ),
    };
    const service = new DocumentPersistenceService({ exporter, repository });

    const first = service.persist(event());
    const second = service.persist(event());
    await vi.waitFor(() => expect(release).toEqual(expect.any(Function)));
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(exporter.exportProjection).toHaveBeenCalledTimes(1);
    expect(repository.calls).toHaveLength(1);
  });

  it('serializes different revisions for one document so each CAS uses the previous version', async () => {
    const repository = new FakeRepository();
    const order: number[] = [];
    let releaseFirst!: () => void;
    let exportCount = 0;
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(
        () =>
          new Promise<{ editorData: Record<string, unknown>; markdown: string }>((resolve) => {
            exportCount += 1;
            if (exportCount === 1) {
              releaseFirst = () => resolve({ editorData: { revision: 1 }, markdown: 'one' });
            } else {
              order.push(2);
              resolve({ editorData: { revision: 2 }, markdown: 'two' });
            }
          }),
      ),
    };
    const service = new DocumentPersistenceService({ exporter, repository });

    const first = service.persist(event());
    await vi.waitFor(() => expect(releaseFirst).toEqual(expect.any(Function)));
    const second = service.persist(
      event({
        revision: 2,
        snapshot: { stateVector: new Uint8Array([2]), update: new Uint8Array([4]) },
      }),
    );
    await Promise.resolve();
    expect(exporter.exportProjection).toHaveBeenCalledTimes(1);
    releaseFirst();
    await first;
    await second;

    expect(order).toEqual([2]);
    expect(repository.calls.map((call) => call.next.revision)).toEqual([1, 2]);
    expect(repository.calls[1].expected.token).toBe('v1');
  });

  it('persists a delete-only snapshot when the state vector is unchanged', async () => {
    const repository = new FakeRepository();
    const exporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi
        .fn()
        .mockResolvedValueOnce({ editorData: { revision: 1 }, markdown: 'before delete' })
        .mockResolvedValueOnce({ editorData: { revision: 2 }, markdown: 'after delete' }),
    };
    const service = new DocumentPersistenceService({ exporter, repository });

    await service.persist(event());
    const result = await service.persist(
      event({
        revision: 2,
        snapshot: { stateVector: new Uint8Array([1]), update: new Uint8Array([4, 5]) },
      }),
    );

    expect(result).toMatchObject({ persisted: true, reason: 'persisted', revision: 2 });
    expect(exporter.exportProjection).toHaveBeenCalledTimes(2);
    expect(repository.calls).toHaveLength(2);
  });

  it('does not rewrite or append history when a restarted service sees the same full snapshot', async () => {
    const repository = new FakeRepository();
    const firstExporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async () => ({ editorData: {}, markdown: 'same' })),
    };
    const firstService = new DocumentPersistenceService({
      exporter: firstExporter,
      repository,
    });
    await firstService.persist(event());
    repository.version = {
      roomId: 'room-1',
      revision: 100,
      snapshotUpdate: Buffer.from([2, 3]).toString('base64'),
      stateVector: 'AQ==',
      token: 'v100',
    };

    const restartedExporter: ReadOnlyHeadlessExporter = {
      exportProjection: vi.fn(async () => ({ editorData: {}, markdown: 'must-not-run' })),
    };
    const restartedService = new DocumentPersistenceService({
      exporter: restartedExporter,
      repository,
    });
    const result = await restartedService.persist(event({ revision: 1 }));

    expect(result).toMatchObject({ persisted: false, reason: 'duplicate' });
    expect(restartedExporter.exportProjection).not.toHaveBeenCalled();
    expect(repository.calls).toHaveLength(1);
  });
});
