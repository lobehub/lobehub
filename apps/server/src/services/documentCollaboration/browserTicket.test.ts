// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createDocumentCollaborationBrowserTicketVerifier,
  createDocumentCollaborationRoomTicketVerifier,
  DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH,
  DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED,
  DocumentCollaborationBrowserTicketService,
} from './browserTicket';

const now = 1_700_000_000_000;
const issueInput = {
  documentId: 'document-1',
  now,
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

describe('DocumentCollaborationBrowserTicketService', () => {
  it('issues a room-bound reusable browser ticket without request or worker claims', () => {
    const service = new DocumentCollaborationBrowserTicketService({
      now: () => now,
      secret: 'browser-secret',
    });
    const token = service.issue(issueInput);
    const claims = service.verify(token, {
      clientKind: 'browser',
      documentId: 'document-1',
      roomId: 'document-1',
    });

    expect(claims).toMatchObject({
      canWrite: true,
      clientKind: 'browser',
      documentId: 'document-1',
      exp: now + 10 * 60 * 1000,
      iat: now,
      roomId: 'document-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect('requestId' in claims).toBe(false);
    expect('workerId' in claims).toBe(false);
    // Browser reconnects may present the same capability again before expiry.
    expect(service.verify(token, { documentId: 'document-1', roomId: 'document-1' })).toEqual(
      claims,
    );
  });

  it('rejects a wrong room and expiry', () => {
    const service = new DocumentCollaborationBrowserTicketService({
      now: () => now,
      secret: 'browser-secret',
    });
    const token = service.issue(issueInput);

    expect(() => service.verify(token, { roomId: 'other-room' })).toThrow(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_BINDING_MISMATCH,
    );
    expect(() => service.verify(token, undefined, now + 10 * 60 * 1000)).toThrow(
      DOCUMENT_COLLABORATION_BROWSER_TICKET_EXPIRED,
    );
  });

  it('returns a reusable browser principal and never accepts it for Agent', async () => {
    const service = new DocumentCollaborationBrowserTicketService({
      now: () => now,
      secret: 'browser-secret',
    });
    const token = service.issue(issueInput);
    const authorize = async () => true;
    const browserVerifier = createDocumentCollaborationBrowserTicketVerifier({
      authorize,
      ticketService: service,
    });

    const result = await browserVerifier({
      clientId: 3,
      clientKind: 'browser',
      documentId: 'document-1',
      roomId: 'document-1',
      ticket: token,
    });
    expect(result).toMatchObject({
      allowed: true,
      clientId: 3,
      expiresAt: now + 10 * 60 * 1000,
      singleUse: false,
      principal: {
        canWrite: true,
        clientKind: 'browser',
        documentId: 'document-1',
        roomId: 'document-1',
        userId: 'user-1',
      },
    });
    expect(
      await browserVerifier({
        clientKind: 'agent',
        documentId: 'document-1',
        roomId: 'document-1',
        ticket: token,
      }),
    ).toBe(false);
  });

  it('routes browser and Agent client kinds to separate verifier families', async () => {
    const service = new DocumentCollaborationBrowserTicketService({
      now: () => now,
      secret: 'browser-secret',
    });
    const token = service.issue(issueInput);
    const agentVerifier = async () => ({ allowed: true, principal: { clientKind: 'agent' } });
    const verifier = createDocumentCollaborationRoomTicketVerifier({
      agentVerifier,
      browser: { authorize: () => true, ticketService: service },
    });

    expect(
      await verifier({
        clientKind: 'browser',
        documentId: 'document-1',
        roomId: 'document-1',
        ticket: token,
      }),
    ).toMatchObject({ allowed: true, singleUse: false });
    expect(
      await verifier({ clientKind: 'agent', roomId: 'document-1', ticket: 'agent-ticket' }),
    ).toEqual({ allowed: true, principal: { clientKind: 'agent' } });
  });

  it('rejects a ticket from another user or workspace even when room and document ids match', async () => {
    const service = new DocumentCollaborationBrowserTicketService({
      now: () => now,
      secret: 'browser-secret',
    });
    const allowedTicket = service.issue(issueInput);
    const foreignTicket = service.issue({
      ...issueInput,
      userId: 'user-2',
      workspaceId: 'workspace-2',
    });
    const verifier = createDocumentCollaborationBrowserTicketVerifier({
      authorize: (claims) => claims.userId === 'user-1' && claims.workspaceId === 'workspace-1',
      ticketService: service,
    });

    await expect(
      verifier({
        clientKind: 'browser',
        documentId: issueInput.documentId,
        roomId: issueInput.documentId,
        ticket: allowedTicket,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      verifier({
        clientKind: 'browser',
        documentId: issueInput.documentId,
        roomId: issueInput.documentId,
        ticket: foreignTicket,
      }),
    ).resolves.toBe(false);
  });
});
