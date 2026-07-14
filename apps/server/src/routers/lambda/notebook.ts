import { type NotebookDocument } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { NotebookRuntimeService } from '@/server/services/notebook';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from './_helpers/assertWorkspaceRowManageable';

const notebookProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      notebookService: new NotebookRuntimeService({
        serverDB: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: wsId,
      }),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const notebookRouter = router({
  createDocument: notebookProcedure
    .use(withScopedPermission('document:create'))
    .input(
      z.object({
        content: z.string(),
        description: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        source: z.string().optional().default('notebook'),
        sourceType: z.enum(['file', 'web', 'api', 'topic']).optional().default('api'),
        title: z.string(),
        topicId: z.string(),
        type: z
          .enum(['article', 'markdown', 'note', 'report', 'agent/plan'])
          .optional()
          .default('markdown'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Create the document
      const document = await ctx.documentModel.create({
        content: input.content,
        description: input.description,
        fileType: input.type,
        metadata: input.metadata,
        source: input.source,
        sourceType: input.sourceType,
        title: input.title,
        totalCharCount: input.content.length,
        totalLineCount: input.content.split('\n').length,
      });

      // Associate with topic
      await ctx.topicDocumentModel.associate({
        documentId: document.id,
        topicId: input.topicId,
      });

      return document;
    }),

  deleteDocument: notebookProcedure
    .use(withScopedPermission('document:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.documentModel.findById(input.id);
      if (!existing) return { success: true };
      assertWorkspaceRowManageable(ctx, existing.userId, 'document');

      // Same cascade rule as documentRouter.deleteDocument: a non-owner's
      // folder delete must not take teammates' descendants with it.
      await ctx.notebookService.deleteDocument(input.id, {
        restrictToCreator: isWorkspaceNonOwner(ctx),
      });

      return { success: true };
    }),

  getDocument: notebookProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentModel.findById(input.id);
    }),

  listDocuments: notebookProcedure
    .input(
      z.object({
        topicId: z.string(),
        type: z.enum(['article', 'markdown', 'note', 'report', 'agent/plan']).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ data: NotebookDocument[]; total: number }> => {
      const documents = await ctx.topicDocumentModel.findByTopicId(input.topicId, {
        type: input.type,
      });

      return {
        data: documents.map((doc) => ({
          associatedAt: doc.associatedAt,
          content: doc.content,
          createdAt: doc.createdAt,
          description: doc.description,
          fileType: doc.fileType,
          id: doc.id,
          metadata: doc.metadata,
          title: doc.title,
          totalCharCount: doc.totalCharCount,
          totalLineCount: doc.totalLineCount,
          updatedAt: doc.updatedAt,
        })),
        total: documents.length,
      };
    }),

  updateDocument: notebookProcedure
    .use(withScopedPermission('document:update'))
    .input(
      z.object({
        append: z.boolean().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        id: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        title: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let contentToUpdate = input.content;

      // Handle append mode
      if (input.append && input.content) {
        const existing = await ctx.documentModel.findById(input.id);
        if (existing?.content) {
          contentToUpdate = existing.content + '\n\n' + input.content;
        }
      }

      await ctx.documentModel.update(input.id, {
        ...(contentToUpdate !== undefined && {
          content: contentToUpdate,
          totalCharCount: contentToUpdate.length,
          totalLineCount: contentToUpdate.split('\n').length,
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        ...(input.title && { title: input.title }),
      });

      return ctx.documentModel.findById(input.id);
    }),
});
