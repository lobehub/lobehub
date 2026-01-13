import { type NotebookDocument } from '@lobechat/types';
import { z } from 'zod';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const notebookProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const notebookRouter = router({
  createDocument: notebookProcedure
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
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Remove associations first
      await ctx.topicDocumentModel.deleteByDocumentId(input.id);
      // Delete the document
      await ctx.documentModel.delete(input.id);

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
