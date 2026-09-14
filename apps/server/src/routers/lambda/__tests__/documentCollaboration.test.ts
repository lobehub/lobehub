// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { documentCollaborationRouter } from '../documentCollaboration';

const mocks = vi.hoisted(() => ({
  assertCanPerformResourceAction: vi.fn(),
  documentFindById: vi.fn(),
  issue: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.documentFindById };
  }),
}));
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: mocks.assertCanPerformResourceAction,
}));
vi.mock('@/server/services/documentCollaboration/browserTicket', () => ({
  DocumentCollaborationBrowserTicketError: class DocumentCollaborationBrowserTicketError extends Error {
    code = 'DOCUMENT_COLLABORATION_BROWSER_TICKET_INVALID';
  },
  DocumentCollaborationBrowserTicketService: class {
    issue = mocks.issue;
    verify = mocks.verify;
  },
  DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING:
    'DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING',
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const callerFor = (workspaceId?: string) =>
  documentCollaborationRouter.createCaller({
    serverDB: {},
    userId: 'user-1',
    workspaceId: workspaceId ?? null,
  } as any);

describe('documentCollaborationRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanPerformResourceAction.mockResolvedValue(undefined);
    mocks.documentFindById.mockResolvedValue({ id: 'document-1' });
    mocks.issue.mockReturnValue('browser-ticket');
    mocks.verify.mockReturnValue({
      clientKind: 'browser',
      documentId: 'document-1',
      exp: Date.parse('2026-08-29T00:10:00.000Z'),
      roomId: 'document-1',
    });
  });

  it('requires document edit ACL and issues a document-bound browser ticket', async () => {
    const result = await callerFor('workspace-1').issueBrowserTicket({
      documentId: 'document-1',
    });

    expect(mocks.assertCanPerformResourceAction).toHaveBeenCalledWith({
      action: 'edit',
      db: {},
      resourceId: 'document-1',
      resourceType: 'document',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mocks.issue).toHaveBeenCalledWith({
      canWrite: true,
      documentId: 'document-1',
      roomId: 'document-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(result).toEqual({
      clientKind: 'browser',
      documentId: 'document-1',
      expiresAt: '2026-08-29T00:10:00.000Z',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    });
  });

  it('uses owner-scoped lookup for personal documents', async () => {
    const result = await callerFor().issueBrowserTicket({ documentId: 'document-1' });

    expect(mocks.documentFindById).toHaveBeenCalledWith('document-1');
    expect(mocks.assertCanPerformResourceAction).not.toHaveBeenCalled();
    expect(result.ticket).toBe('browser-ticket');
  });

  it('does not issue a ticket when the document ACL denies access', async () => {
    mocks.assertCanPerformResourceAction.mockRejectedValueOnce(
      new TRPCError({ code: 'FORBIDDEN' }),
    );

    await expect(
      callerFor('workspace-1').issueBrowserTicket({ documentId: 'document-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('does not accept request or worker ticket fields at the endpoint', async () => {
    await expect(
      callerFor('workspace-1').issueBrowserTicket({
        documentId: 'document-1',
        requestId: 'rewrite-1',
        workerId: 'worker-1',
      } as never),
    ).rejects.toThrow();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
