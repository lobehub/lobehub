import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING,
  DocumentCollaborationBrowserTicketError,
  DocumentCollaborationBrowserTicketService,
} from '@/server/services/documentCollaboration/browserTicket';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

const idSchema = z.string().trim().min(1).max(255);
const issueBrowserTicketSchema = z.object({ documentId: idSchema }).strict();

export type DocumentCollaborationRouterContext = {
  serverDB: Parameters<typeof assertCanPerformResourceAction>[0]['db'];
  userId: string;
  workspaceId?: string | null;
};

const documentCollaborationProcedure = wsCompatProcedure.use(serverDatabase);

/**
 * Browser collaboration can write through the editor binding, so issuing its
 * room capability requires document edit access. Personal documents use the
 * owner-scoped DocumentModel; workspace documents use the resource ACL.
 */
const assertDocumentEditAccess = async (
  ctx: DocumentCollaborationRouterContext,
  documentId: string,
): Promise<void> => {
  if (ctx.workspaceId) {
    await assertCanPerformResourceAction({
      action: 'edit',
      db: ctx.serverDB,
      resourceId: documentId,
      resourceType: 'document',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return;
  }

  const document = await new DocumentModel(ctx.serverDB, ctx.userId).findById(documentId);
  if (!document) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
};

const toTRPCError = (error: unknown): never => {
  if (error instanceof DocumentCollaborationBrowserTicketError) {
    if (error.code === DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET_MISSING) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Browser collaboration is not configured',
      });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw error;
};

export const documentCollaborationRouter = router({
  issueBrowserTicket: documentCollaborationProcedure
    .input(issueBrowserTicketSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentEditAccess(ctx, input.documentId);
      try {
        const service = new DocumentCollaborationBrowserTicketService();
        const ticket = service.issue({
          canWrite: true,
          documentId: input.documentId,
          roomId: input.documentId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        const claims = service.verify(ticket, {
          clientKind: 'browser',
          documentId: input.documentId,
          roomId: input.documentId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        return {
          clientKind: claims.clientKind,
          documentId: claims.documentId,
          expiresAt: new Date(claims.exp).toISOString(),
          roomId: claims.roomId,
          ticket,
        };
      } catch (error) {
        return toTRPCError(error);
      }
    }),
});

export type DocumentCollaborationRouter = typeof documentCollaborationRouter;
