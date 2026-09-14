// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH,
  DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED,
  DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
  DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED,
  DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING,
  DocumentRewriteRoomTicketError,
  DocumentRewriteRoomTicketService,
} from './roomTicket';
import { createDocumentRewriteRoomTicketVerifier } from './service';

const input = {
  agentId: 'agent-1',
  attempt: 2,
  documentId: 'document-1',
  requestId: 'request-1',
  roomId: 'room-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
} as const;

describe('DocumentRewriteRoomTicketService', () => {
  it('issues and verifies claims bound to request/document/workspace/attempt', () => {
    const service = new DocumentRewriteRoomTicketService({
      now: () => 1_000_000,
      secret: 'ticket-secret',
    });
    const token = service.issue({ ...input, now: 1_000_000 });

    expect(service.verify(token, input, 1_001_000)).toMatchObject({
      ...input,
      attempt: 2,
      clientKind: 'agent',
      exp: 1_300_000,
      iat: 1_000_000,
    });
  });

  it('rejects tampering, a mismatched binding, and replay', () => {
    const service = new DocumentRewriteRoomTicketService({
      now: () => 2_000_000,
      secret: 'ticket-secret',
    });
    const token = service.issue({ ...input, now: 2_000_000 });

    expect(() => service.verify(`${token.slice(0, -1)}x`, input, 2_000_001)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
    );
    expect(() => service.verify(token, { ...input, attempt: 3 }, 2_000_001)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH,
    );
    expect(service.consume(token, input, 2_000_001)).toMatchObject(input);
    expect(() => service.consume(token, input, 2_000_002)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_REPLAYED,
    );
  });

  it('rejects expiry, oversized tokens, missing secrets, and invalid issue inputs', () => {
    const service = new DocumentRewriteRoomTicketService({
      now: () => 3_000_000,
      secret: 'ticket-secret',
    });
    const token = service.issue({ ...input, now: 3_000_000, ttlMs: 1_000 });
    expect(() => service.verify(token, input, 3_001_000)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_EXPIRED,
    );
    expect(() => service.verify(`${token}a`.repeat(10_000), input, 3_000_001)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
    );
    expect(() =>
      new DocumentRewriteRoomTicketService().issue({ ...input, now: 3_000_000 }),
    ).toThrow(DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING);
    expect(() => service.issue({ ...input, clientKind: 'browser' as never })).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
    );
    expect(() => service.verify(token, input, 2_900_000)).toThrow(
      DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
    );
  });

  it('supports an injected atomic replay boundary', () => {
    const consumed = new Set<string>();
    const replayStore = {
      consume: (nonce: string) => !consumed.has(nonce) && (consumed.add(nonce), true),
      prune: () => undefined,
    };
    const service = new DocumentRewriteRoomTicketService({
      now: () => 4_000_000,
      replayStore,
      secret: 'ticket-secret',
    });
    const token = service.issue({ ...input, now: 4_000_000 });
    expect(service.consume(token, input, 4_000_001)).toBeTruthy();
    expect(() => service.consume(token, input, 4_000_002)).toThrow(DocumentRewriteRoomTicketError);
  });

  it('requires a deployment authorization callback after consuming a worker-bound ticket', async () => {
    const ticketService = new DocumentRewriteRoomTicketService({
      now: () => 5_000_000,
      secret: 'ticket-secret',
    });
    const token = ticketService.issue({ ...input, now: 5_000_000, workerId: 'worker-1' });
    const authorize = async (claims: { workerId?: string }) => claims.workerId === 'worker-1';
    const verifier = createDocumentRewriteRoomTicketVerifier({ authorize, ticketService });

    await expect(
      verifier({
        clientKind: 'agent',
        documentId: input.documentId,
        requestId: input.requestId,
        roomId: input.roomId,
        ticket: token,
        workerId: 'worker-1',
      }),
    ).resolves.toMatchObject({ allowed: true, principal: { workerId: 'worker-1' } });
    // A consumed ticket cannot be replayed even if a later verifier callback
    // would otherwise approve the same claim.
    await expect(
      verifier({
        clientKind: 'agent',
        documentId: input.documentId,
        requestId: input.requestId,
        roomId: input.roomId,
        ticket: token,
        workerId: 'worker-1',
      }),
    ).resolves.toBe(false);
  });
});
