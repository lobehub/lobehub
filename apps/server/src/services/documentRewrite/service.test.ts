// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_REWRITE_ACTIVE_LIMIT,
  DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED,
} from '@/database/models/documentRewriteRequest';
import type { DocumentRewriteRequestItem } from '@/database/schemas/documentRewriteRequest';

import { DOCUMENT_REWRITE_DISABLED } from './featureGate';
import { verifyDocumentRewriteRoomTicket } from './roomTicket';
import {
  createDatabaseDocumentRewriteTicketAuthorizer,
  DocumentRewriteRequestService,
} from './service';

const previousFeatureFlag = process.env.PAGE_AGENT_TARGETED_REWRITE_ENABLED;

afterEach(() => {
  if (previousFeatureFlag === undefined) delete process.env.PAGE_AGENT_TARGETED_REWRITE_ENABLED;
  else process.env.PAGE_AGENT_TARGETED_REWRITE_ENABLED = previousFeatureFlag;
});

const request = (overrides: Partial<DocumentRewriteRequestItem> = {}) =>
  ({
    agentId: 'agent-1',
    attempt: 1,
    cancelRequestedAt: null,
    id: 'request-1',
    documentId: 'room-1',
    selection: {
      anchorPos: {},
      focusPos: {},
      kind: 'relative',
      quotedText: 'selected text',
      quotedTextHash: 'hash',
      roomId: 'room-1',
    },
    status: 'queued',
    ...overrides,
  }) as DocumentRewriteRequestItem;

describe('DocumentRewriteRequestService queue handoff', () => {
  it('blocks new requests without touching the model while the rollback switch is off', async () => {
    process.env.PAGE_AGENT_TARGETED_REWRITE_ENABLED = '0';
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null);
    const model = (service as unknown as { model: { create: ReturnType<typeof vi.fn> } }).model;
    model.create = vi.fn();

    await expect(service.create({} as never)).rejects.toThrow(DOCUMENT_REWRITE_DISABLED);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('publishes only after the request transaction returns and preserves queued state on outage', async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error('queue offline'));
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      onQueueError: vi.fn(),
      queue: { enqueue },
    });
    const model = (service as unknown as { model: { create: () => Promise<unknown> } }).model;
    model.create = vi.fn(async () => ({ isDuplicate: false, request: request() }));

    const result = await service.create({} as never);
    expect(result.request.status).toBe('queued');
    expect(enqueue).toHaveBeenCalledWith({ attempt: 1, requestId: 'request-1' });
    expect(
      (service as unknown as { onQueueError: ReturnType<typeof vi.fn> }).onQueueError,
    ).toHaveBeenCalled();
  });

  it('creates and enqueues a continuation after the parent has been validated by the model', async () => {
    const enqueue = vi.fn().mockResolvedValue('delivery-2');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const continued = request({
      id: 'request-2',
      parentRequestId: 'request-1',
      sessionId: 'rws_session-1',
      status: 'queued',
      turnIndex: 2,
    });
    const model = (service as unknown as { model: { continue: ReturnType<typeof vi.fn> } }).model;
    model.continue = vi.fn(async () => ({ isDuplicate: false, request: continued }));

    const result = await service.continue('request-1', { instruction: 'Make it warmer' });

    expect(model.continue).toHaveBeenCalledWith('request-1', { instruction: 'Make it warmer' });
    expect(enqueue).toHaveBeenCalledWith({ attempt: 1, requestId: 'request-2' });
    expect(result?.request).toMatchObject({ parentRequestId: 'request-1', turnIndex: 2 });
  });

  it('enqueues the committed retry attempt immediately and reports delivery', async () => {
    const enqueue = vi.fn().mockResolvedValue('delivery-retry-2');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const retried = request({ attempt: 2, status: 'retry_wait' });
    const model = (service as unknown as { model: { retry: ReturnType<typeof vi.fn> } }).model;
    model.retry = vi.fn(async () => ({ isDuplicate: false, request: retried }));

    const result = await service.retry('request-1', { attempt: 1, delayMs: 321 });

    expect(model.retry).toHaveBeenCalledWith('request-1', { attempt: 1, delayMs: 321 });
    expect(enqueue).toHaveBeenCalledWith({ attempt: 2, requestId: 'request-1' }, { delayMs: 321 });
    expect(result).toMatchObject({ deliveryStatus: 'enqueued', request: retried });
  });

  it('keeps retry_wait recoverable and reports a queue outage instead of faking start', async () => {
    const queueError = new Error('queue offline');
    const enqueue = vi.fn().mockRejectedValue(queueError);
    const onQueueError = vi.fn();
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      onQueueError,
      queue: { enqueue },
    });
    const retried = request({ attempt: 2, status: 'retry_wait' });
    const model = (service as unknown as { model: { retry: ReturnType<typeof vi.fn> } }).model;
    model.retry = vi.fn(async () => ({ isDuplicate: false, request: retried }));

    const result = await service.retry('request-1', { attempt: 1 });

    expect(result).toMatchObject({
      deliveryStatus: 'enqueue_failed',
      request: { attempt: 2, status: 'retry_wait' },
    });
    expect(onQueueError).toHaveBeenCalledWith(queueError, retried);
  });

  it('does not enqueue a retry result that the model marked duplicate', async () => {
    const enqueue = vi.fn().mockResolvedValue('should-not-run');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const duplicate = request({ attempt: 2, status: 'retry_wait' });
    const model = (service as unknown as { model: { retry: ReturnType<typeof vi.fn> } }).model;
    model.retry = vi.fn(async () => ({ isDuplicate: true, request: duplicate }));

    const result = await service.retry('request-1', { attempt: 1 });

    expect(result).toEqual({ isDuplicate: true, request: duplicate });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not publish an idempotent duplicate a second time', async () => {
    const enqueue = vi.fn().mockResolvedValue('delivery-1');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const model = (service as unknown as { model: { create: () => Promise<unknown> } }).model;
    model.create = vi.fn(async () => ({ isDuplicate: true, request: request() }));

    await service.create({} as never);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('re-drives an existing queued request once and updates its instruction through the model', async () => {
    const enqueue = vi.fn().mockResolvedValue('delivery-1');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const model = (
      service as unknown as {
        model: {
          findById: () => Promise<unknown>;
          updateInstruction: () => Promise<unknown>;
        };
      }
    ).model;
    const queued = request();
    model.findById = vi.fn(async () => queued);
    model.updateInstruction = vi.fn(async () => ({ ...queued, instruction: 'Updated' }));

    const [first, second] = await Promise.all([
      service.enqueueExisting('request-1', { instruction: 'Updated' }),
      service.enqueueExisting('request-1', { instruction: 'Updated' }),
    ]);

    expect(model.updateInstruction).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ attempt: 1, requestId: 'request-1' });
    expect(first.request.instruction).toBe('Updated');
    expect(second.request.instruction).toBe('Updated');
  });

  it('does not enqueue an in-flight request or allow a different instruction after it leaves queued', async () => {
    const enqueue = vi.fn().mockResolvedValue('delivery-1');
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null, {
      queue: { enqueue },
    });
    const model = (
      service as unknown as {
        model: {
          findById: () => Promise<unknown>;
          updateInstruction: () => Promise<unknown>;
        };
      }
    ).model;
    const active = request({ status: 'thinking' });
    model.findById = vi.fn(async () => active);
    model.updateInstruction = vi.fn(async () => {
      throw new Error(
        'DOCUMENT_REWRITE_REQUEST_CONFLICT: instruction can only be updated while queued',
      );
    });

    await expect(
      service.enqueueExisting('request-1', { instruction: 'Changed after claim' }),
    ).rejects.toThrow('instruction can only be updated while queued');
    expect(enqueue).not.toHaveBeenCalled();

    const result = await service.enqueueExisting('request-1');
    expect(result.request.status).toBe('thinking');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('forwards session deletion to the scoped model without adding document mutations', async () => {
    const service = new DocumentRewriteRequestService({} as never, 'user-1', 'workspace-1');
    const model = (
      service as unknown as {
        model: { deleteSession: ReturnType<typeof vi.fn> };
      }
    ).model;
    model.deleteSession = vi.fn().mockResolvedValue({
      deletedCount: 2,
      documentId: 'room-1',
      requestId: 'request-1',
      sessionId: 'rws_session-1',
    });

    const result = await service.deleteSession({
      documentId: 'room-1',
      sessionId: 'rws_session-1',
    });

    expect(model.deleteSession).toHaveBeenCalledWith({
      documentId: 'room-1',
      sessionId: 'rws_session-1',
    });
    expect(result).toMatchObject({ deletedCount: 2, sessionId: 'rws_session-1' });
  });

  it('requires the live worker claim and bounds room-ticket TTL by the lease', async () => {
    const previousSecret = process.env.DOCUMENT_REWRITE_TICKET_SECRET;
    process.env.DOCUMENT_REWRITE_TICKET_SECRET = 'service-test-ticket-secret';
    try {
      const service = new DocumentRewriteRequestService({} as never, 'user-1');
      const model = (
        service as unknown as {
          model: {
            assertCapacityForRequest: () => Promise<unknown>;
            findById: () => Promise<unknown>;
          };
        }
      ).model;
      model.findById = vi.fn(async () =>
        request({
          claimOwner: 'worker-1',
          leaseExpiresAt: new Date(Date.now() + 5_000),
          status: 'connecting',
        }),
      );
      model.assertCapacityForRequest = vi.fn(() => model.findById());

      const token = await service.issueRoomTicket('request-1', {
        attempt: 1,
        roomId: 'room-1',
        workerId: 'worker-1',
      });
      const claims = verifyDocumentRewriteRoomTicket(token, {
        attempt: 1,
        requestId: 'request-1',
        roomId: 'room-1',
        workerId: 'worker-1',
      });
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(5_000);

      await expect(
        service.issueRoomTicket('request-1', {
          attempt: 1,
          roomId: 'other-room',
          workerId: 'worker-1',
        }),
      ).rejects.toThrow('DOCUMENT_REWRITE_ROOM_TICKET_INVALID');

      model.findById = vi.fn(async () =>
        request({ claimOwner: 'other-worker', status: 'connecting' }),
      );
      await expect(
        service.issueRoomTicket('request-1', {
          attempt: 1,
          roomId: 'room-1',
          workerId: 'worker-1',
        }),
      ).rejects.toThrow(DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED);
    } finally {
      if (previousSecret === undefined) delete process.env.DOCUMENT_REWRITE_TICKET_SECRET;
      else process.env.DOCUMENT_REWRITE_TICKET_SECRET = previousSecret;
    }
  });

  it('does not issue a room ticket when the document Agent capacity is full', async () => {
    const service = new DocumentRewriteRequestService({} as never, 'user-1', null);
    const model = (
      service as unknown as {
        model: { assertCapacityForRequest: ReturnType<typeof vi.fn> };
      }
    ).model;
    model.assertCapacityForRequest = vi
      .fn()
      .mockRejectedValue(new Error(DOCUMENT_REWRITE_ACTIVE_LIMIT));

    await expect(
      service.issueRoomTicket('request-1', {
        attempt: 1,
        roomId: 'room-1',
        workerId: 'worker-1',
      }),
    ).rejects.toThrow(DOCUMENT_REWRITE_ACTIVE_LIMIT);
  });

  it('authorizes only the current request owner and live worker lease', async () => {
    const currentRequest = request({
      agentId: 'agent-1',
      attempt: 2,
      claimOwner: 'worker-1',
      documentId: 'room-1',
      expiresAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      requestedByUserId: 'user-1',
      selection: {
        anchorPos: {},
        baseStateVector: 'state-vector',
        capturedAt: '2026-08-29T00:00:00.000Z',
        focusPos: {},
        kind: 'relative',
        quotedText: '',
        quotedTextHash: 'hash',
        roomId: 'room-1',
      },
      status: 'thinking',
      workspaceId: null,
    });
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [currentRequest] }),
        }),
      }),
    } as never;
    const authorize = createDatabaseDocumentRewriteTicketAuthorizer(db, {
      authorizeAgent: vi.fn(() => true),
      authorizeDocumentEdit: vi.fn(() => true),
    });
    const claims = {
      agentId: 'agent-1',
      attempt: 2,
      clientKind: 'agent' as const,
      documentId: 'room-1',
      exp: Date.now() + 60_000,
      iat: Date.now(),
      nonce: 'opaque-ticket-id',
      requestId: 'request-1',
      roomId: 'room-1',
      userId: 'user-1',
      version: 'lobe-rewrite-room-v1' as const,
      workerId: 'worker-1',
      workspaceId: null,
    };

    await expect(authorize(claims)).resolves.toBe(true);
    await expect(authorize({ ...claims, userId: 'other-user' })).resolves.toBe(false);
    await expect(authorize({ ...claims, workerId: 'takeover-worker' })).resolves.toBe(false);

    currentRequest.leaseExpiresAt = new Date(Date.now() - 1);
    await expect(authorize(claims)).resolves.toBe(false);

    currentRequest.leaseExpiresAt = new Date(Date.now() + 60_000);
    const revokedDocument = createDatabaseDocumentRewriteTicketAuthorizer(db, {
      authorizeDocumentEdit: () => false,
    });
    await expect(revokedDocument(claims)).resolves.toBe(false);
    const revokedAgent = createDatabaseDocumentRewriteTicketAuthorizer(db, {
      authorizeAgent: () => false,
    });
    await expect(revokedAgent(claims)).resolves.toBe(false);
  });
});
