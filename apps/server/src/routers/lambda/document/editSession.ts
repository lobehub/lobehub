import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { FREE_DOCUMENT_HISTORY_WINDOW_DAYS } from '@/const/documentHistory';

import { assertContentsNotInRestrictedKnowledgeBase } from '../_helpers/knowledgeBaseAccess';
import {
  compareDocumentHistoryItemsInputSchema,
  getDocumentHistoryItemInputSchema,
  listDocumentHistoryInputSchema,
  saveDocumentHistoryInputSchema,
} from '../_schema/documentHistory';
import { documentProcedure } from './procedures';

const getFreeDocumentHistorySince = () => {
  const now = Date.now();

  return new Date(now - FREE_DOCUMENT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
};

export const editSessionProcedures = {
  listDocumentHistory: documentProcedure
    .input(listDocumentHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.documentId]);
      return ctx.documentService.listDocumentHistory(
        {
          ...input,
          beforeSavedAt: input.beforeSavedAt ? new Date(input.beforeSavedAt) : undefined,
        },
        {
          historySince: getFreeDocumentHistorySince(),
        },
      );
    }),
  getDocumentHistoryItem: documentProcedure
    .input(getDocumentHistoryItemInputSchema)
    .query(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.documentId]);
      return ctx.documentService.getDocumentHistoryItem(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),
  compareDocumentHistoryItems: documentProcedure
    .input(compareDocumentHistoryItemsInputSchema)
    .query(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.documentId]);
      return ctx.documentService.compareDocumentHistoryItems(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),
  saveDocumentHistory: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(saveDocumentHistoryInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.documentId]);

      const editorData = JSON.parse(input.editorData);
      return ctx.documentService.saveDocumentHistory(
        input.documentId,
        editorData,
        input.saveSource,
        input.lockOwnerId,
      );
    }),
  acquireDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.id]);

      return input.ownerId
        ? ctx.documentService.acquireDocumentLockWithOwner(input.id, input.ownerId)
        : ctx.documentService.acquireDocumentLock(input.id);
    }),
  getDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.id]);
      return ctx.documentService.getDocumentLock(input.id, input.ownerId);
    }),
  releaseDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string(), ownerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.id]);
      if (input.ownerId)
        await ctx.documentService.releaseDocumentLockWithOwner(input.id, input.ownerId);
      else await ctx.documentService.releaseDocumentLock(input.id);
    }),
};
