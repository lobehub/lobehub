import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { FREE_DOCUMENT_HISTORY_WINDOW_DAYS } from '@/const/documentHistory';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { workspaceMembers } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';
import { TransferErrorCode } from '@/types/transferError';

import {
  compareDocumentHistoryItemsInputSchema,
  getDocumentHistoryItemInputSchema,
  listDocumentHistoryInputSchema,
  saveDocumentHistoryInputSchema,
  updateDocumentInputSchema,
} from './_schema/documentHistory';

const getFreeDocumentHistorySince = () => {
  const now = Date.now();

  return new Date(now - FREE_DOCUMENT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
};

const documentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId, wsId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId, wsId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const documentRouter = router({
  createDocument: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        content: z.string().optional(),
        editorData: z.string().optional(),
        fileType: z.string().optional(),
        knowledgeBaseId: z.string().optional(),
        metadata: z.record(z.any()).optional(),
        parentId: z.string().optional(),
        slug: z.string().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve parentId if it's a slug
      let resolvedParentId = input.parentId;
      if (input.parentId) {
        const docBySlug = await ctx.documentModel.findBySlug(input.parentId);
        if (docBySlug) {
          resolvedParentId = docBySlug.id;
        }
      }

      // Parse editorData from JSON string to object
      const editorData = input.editorData ? JSON.parse(input.editorData) : undefined;
      return ctx.documentService.createDocument({
        ...input,
        editorData,
        parentId: resolvedParentId,
      });
    }),

  createDocuments: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        documents: z.array(
          z.object({
            content: z.string().optional(),
            editorData: z.string(),
            fileType: z.string().optional(),
            knowledgeBaseId: z.string().optional(),
            metadata: z.record(z.any()).optional(),
            parentId: z.string().optional(),
            slug: z.string().optional(),
            title: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Process each document: resolve parentId and parse editorData
      const processedDocuments = await Promise.all(
        input.documents.map(async (doc) => {
          // Resolve parentId if it's a slug
          let resolvedParentId = doc.parentId;
          if (doc.parentId) {
            const docBySlug = await ctx.documentModel.findBySlug(doc.parentId);
            if (docBySlug) {
              resolvedParentId = docBySlug.id;
            }
          }

          // Parse editorData from JSON string to object
          const editorData = JSON.parse(doc.editorData);

          return {
            ...doc,
            editorData,
            parentId: resolvedParentId,
          };
        }),
      );

      return ctx.documentService.createDocuments(processedDocuments);
    }),

  deleteDocument: documentProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.documentService.deleteDocument(input.id);
    }),

  deleteDocuments: documentProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.documentService.deleteDocuments(input.ids);
    }),

  getDocumentById: documentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentService.getDocumentById(input.id);
    }),

  listDocumentHistory: documentProcedure
    .input(listDocumentHistoryInputSchema)
    .query(async ({ ctx, input }) => {
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
      return ctx.documentService.getDocumentHistoryItem(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),

  compareDocumentHistoryItems: documentProcedure
    .input(compareDocumentHistoryItemsInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.documentService.compareDocumentHistoryItems(input, {
        historySince: getFreeDocumentHistorySince(),
      });
    }),

  saveDocumentHistory: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(saveDocumentHistoryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const editorData = JSON.parse(input.editorData);
      return ctx.documentService.saveDocumentHistory(
        input.documentId,
        editorData,
        input.saveSource,
      );
    }),

  getFolderBreadcrumb: documentProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const chain = [];
      let currentFolder = await ctx.documentModel.findBySlug(input.slug);

      // Build chain from current folder to root
      while (currentFolder) {
        chain.unshift({
          id: currentFolder.id,
          name: currentFolder.title || currentFolder.filename || 'Untitled',
          slug: currentFolder.slug || currentFolder.id,
        });

        // Find parent folder
        if (currentFolder.parentId) {
          currentFolder = await ctx.documentModel.findById(currentFolder.parentId);
        } else {
          break;
        }
      }

      return chain;
    }),

  parseDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lobeDocument = await ctx.documentService.parseDocument(input.id);

      return lobeDocument;
    }),

  parseFileContent: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        id: z.string(),
        skipExist: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lobeDocument = await ctx.documentService.parseFile(input.id);

      return lobeDocument;
    }),

  queryDocuments: documentProcedure
    .input(
      z
        .object({
          current: z.number().optional(),
          fileTypes: z.array(z.string()).optional(),
          pageSize: z.number().max(100).optional(),
          sourceTypes: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.documentService.queryDocuments(input);
    }),

  acquireDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.documentService.acquireDocumentLock(input.id);
    }),

  getDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentService.getDocumentLock(input.id);
    }),

  releaseDocumentLock: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.documentService.releaseDocumentLock(input.id);
    }),

  updateDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(updateDocumentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, editorData: editorDataString, ...params } = input;
      // Parse editorData from JSON string to object if present
      const editorData = editorDataString ? JSON.parse(editorDataString) : undefined;
      const result = await ctx.documentService.updateDocument(id, {
        ...params,
        editorData,
      });

      return result;
    }),

  transferDocument: documentProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        documentId: z.string(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.documentModel.findById(input.documentId);
      if (!doc)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Document not found',
        });

      // Workspace mode: only owners can transfer items created by others
      if (ctx.workspaceId && doc.userId !== ctx.userId) {
        const [membership] = await ctx.serverDB
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ctx.workspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!membership || membership.role !== 'owner') {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: 'Only workspace owners can transfer items created by others',
          });
        }
      }

      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer document to the same workspace',
        });
      }

      if (input.targetWorkspaceId) {
        const [targetMembership] = await ctx.serverDB
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.targetWorkspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!targetMembership || targetMembership.role === 'viewer') {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.documentId);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      return ctx.documentModel.transferTo(input.documentId, input.targetWorkspaceId, ctx.userId);
    }),

  copyDocumentToWorkspace: documentProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        documentId: z.string(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.documentModel.findById(input.documentId);
      if (!doc)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Document not found',
        });

      if (input.targetWorkspaceId) {
        const [targetMembership] = await ctx.serverDB
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.targetWorkspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!targetMembership || targetMembership.role === 'viewer') {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.documentId);
      await businessFileTransferStorageCheck({
        additionalSize,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });

      return ctx.documentModel.copyToWorkspace(
        input.documentId,
        input.targetWorkspaceId,
        ctx.userId,
      );
    }),
});
