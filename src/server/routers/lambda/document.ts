import { z } from 'zod';

import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';

const documentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const documentRouter = router({
  createDocument: documentProcedure
    .input(
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
      const editorData = JSON.parse(input.editorData);
      return ctx.documentService.createDocument({
        ...input,
        editorData,
        parentId: resolvedParentId,
      });
    }),

  createDocuments: documentProcedure
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
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.documentService.deleteDocument(input.id);
    }),

  deleteDocuments: documentProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.documentService.deleteDocuments(input.ids);
    }),

  getDocumentById: documentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.documentService.getDocumentById(input.id);
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
          pageSize: z.number().optional(),
          sourceTypes: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.documentService.queryDocuments(input);
    }),

  updateDocument: documentProcedure
    .input(
      z.object({
        content: z.string().optional(),
        editorData: z.string().optional(),
        fileType: z.string().optional(),
        id: z.string(),
        metadata: z.record(z.any()).optional(),
        parentId: z.string().nullable().optional(),
        rawData: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, editorData: editorDataString, ...params } = input;
      // Parse editorData from JSON string to object if present
      const editorData = editorDataString ? JSON.parse(editorDataString) : undefined;
      return ctx.documentService.updateDocument(id, {
        ...params,
        editorData,
      });
    }),
});
