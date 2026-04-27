import {
  DOCUMENT_TEMPLATES,
  DocumentLoadFormat,
  DocumentLoadRule,
} from '@lobechat/agent-templates';
import { z } from 'zod';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { TopicModel } from '@/database/models/topic';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

const MAX_METADATA_BYTES = 16 * 1024;
const MAX_RULE_REGEXP_LENGTH = 512;

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, {
    message: `metadata must be ${MAX_METADATA_BYTES} bytes or smaller`,
  });

const toolLoadRuleSchema = z.object({
  keywordMatchMode: z.enum(['any', 'all']).optional(),
  keywords: z.array(z.string()).optional(),
  maxTokens: z.number().int().min(0).optional(),
  policyLoadFormat: z.nativeEnum(DocumentLoadFormat).optional(),
  priority: z.number().int().min(0).optional(),
  regexp: z.string().max(MAX_RULE_REGEXP_LENGTH).optional(),
  rule: z.nativeEnum(DocumentLoadRule).optional(),
  timeRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
});

const readFormatSchema = z.enum(['xml', 'markdown', 'both']).optional();

const liteXMLOperationSchema = z.union([
  z.object({
    action: z.literal('insert'),
    beforeId: z.string(),
    litexml: z.string(),
  }),
  z.object({
    action: z.literal('insert'),
    afterId: z.string(),
    litexml: z.string(),
  }),
  z.object({
    action: z.literal('modify'),
    litexml: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    action: z.literal('remove'),
    id: z.string(),
  }),
]);

const agentDocumentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentDocumentModel: new AgentDocumentModel(ctx.serverDB, ctx.userId),
      agentDocumentService: new AgentDocumentsService(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const agentDocumentRouter = router({
  /**
   * Get all available template sets
   */
  getTemplates: agentDocumentProcedure.query(async () => {
    return Object.entries(DOCUMENT_TEMPLATES).map(([id, template]) => ({
      description: template.description,
      filenames: template.templates.map((item) => item.filename),
      id,
      name: template.name,
    }));
  }),

  /**
   * Get all documents for an agent
   */
  getDocuments: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.agentDocumentService.getAgentDocuments(input.agentId);
    }),

  /**
   * Get a specific document by filename
   */
  getDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        filename: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.agentDocumentService.getDocument(input.agentId, input.filename);
    }),

  /**
   * Create or update a document
   */
  upsertDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        createdAt: z.date().optional(),
        filename: z.string(),
        metadata: metadataSchema.optional(),
        updatedAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.upsertDocument({
        agentId: input.agentId,
        content: input.content,
        createdAt: input.createdAt,
        filename: input.filename,
        metadata: input.metadata,
        updatedAt: input.updatedAt,
      });
    }),

  /**
   * Delete a specific document
   */
  deleteDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        filename: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.agentDocumentService.getDocument(input.agentId, input.filename);
      if (!doc) return;

      return ctx.agentDocumentService.deleteDocument(doc.id);
    }),

  /**
   * Delete all documents for an agent
   */
  deleteAllDocuments: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.deleteAllDocuments(input.agentId);
    }),

  /**
   * Initialize documents from a template set
   */
  initializeFromTemplate: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        templateSet: z.enum(Object.keys(DOCUMENT_TEMPLATES) as [string, ...string[]]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.initializeFromTemplate(
        input.agentId,
        input.templateSet as keyof typeof DOCUMENT_TEMPLATES,
      );
    }),

  /**
   * Get agent context for conversations
   */
  getContext: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.agentDocumentService.getAgentContext(input.agentId);
    }),

  /**
   * Get documents as a map
   */
  getDocumentsMap: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const map = await ctx.agentDocumentService.getDocumentsMap(input.agentId);
      // Convert Map to object for JSON serialization
      return Object.fromEntries(map);
    }),

  /**
   * Clone documents from one agent to another
   */
  cloneDocuments: agentDocumentProcedure
    .input(
      z.object({
        sourceAgentId: z.string(),
        targetAgentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.cloneDocuments(input.sourceAgentId, input.targetAgentId);
    }),

  /**
   * Check if agent has documents
   */
  hasDocuments: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.agentDocumentService.hasDocuments(input.agentId);
    }),

  /**
   * Tool-oriented: list documents for an agent
   */
  listDocuments: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        target: z.enum(['agent', 'currentTopic']).optional().default('agent'),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.target === 'currentTopic') {
        if (!input.topicId) throw new Error('topicId is required to list current topic documents');

        return ctx.agentDocumentService.listDocumentsForTopic(input.agentId, input.topicId);
      }

      return ctx.agentDocumentService.listDocuments(input.agentId);
    }),

  /**
   * Tool-oriented: read document by filename
   */
  readDocumentByFilename: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        format: readFormatSchema,
        filename: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return input.format
        ? ctx.agentDocumentService.getDocumentSnapshotByFilename(input.agentId, input.filename)
        : ctx.agentDocumentService.getDocumentByFilename(input.agentId, input.filename);
    }),

  /**
   * Tool-oriented: upsert document by filename
   */
  upsertDocumentByFilename: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        filename: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.upsertDocumentByFilename({
        agentId: input.agentId,
        content: input.content,
        filename: input.filename,
      });
    }),

  /**
   * Tool-oriented: associate an existing document with an agent
   */
  associateDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        documentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.associateDocument(input.agentId, input.documentId);
    }),

  /**
   * Tool-oriented: create document
   */
  createDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.createDocument(input.agentId, input.title, input.content);
    }),

  /**
   * Create an agent document and associate it with a topic in one call.
   * Used by the topic → page flow to replace the legacy notebook entry point.
   */
  createForTopic: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        title: z.string(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const topic = input.title.trim() ? undefined : await ctx.topicModel.findById(input.topicId);
      const title = input.title.trim() || topic?.title || '';
      const doc = await ctx.agentDocumentService.createForTopic(
        input.agentId,
        title,
        input.content,
        input.topicId,
      );

      return doc;
    }),

  /**
   * Tool-oriented: read document by id
   */
  readDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        format: readFormatSchema,
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return input.format
        ? ctx.agentDocumentService.getDocumentSnapshotById(input.id, input.agentId)
        : ctx.agentDocumentService.getDocumentById(input.id, input.agentId);
    }),

  /**
   * Tool-oriented: modify document nodes by id through LiteXML.
   */
  modifyNodes: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        id: z.string(),
        operations: z.array(liteXMLOperationSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.modifyDocumentNodesById(
        input.id,
        input.operations,
        input.agentId,
      );
    }),

  /**
   * Tool-oriented: edit document content by id
   */
  editDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.editDocumentById(input.id, input.content, input.agentId);
    }),

  /**
   * Tool-oriented: remove document by id
   */
  removeDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.agentDocumentService.removeDocumentById(input.id, input.agentId);
      return { deleted, id: input.id };
    }),

  /**
   * Tool-oriented: copy document by id
   */
  copyDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        id: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.copyDocumentById(input.id, input.newTitle, input.agentId);
    }),

  /**
   * Tool-oriented: rename document by id
   */
  renameDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        id: z.string(),
        newTitle: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.renameDocumentById(input.id, input.newTitle, input.agentId);
    }),

  /**
   * Tool-oriented: update document load rule by id
   */
  updateLoadRule: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        id: z.string(),
        rule: toolLoadRuleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.updateLoadRuleById(input.id, input.rule, input.agentId);
    }),
});
