import { DOCUMENT_TEMPLATES } from '@lobechat/agent-templates';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TopicTrigger } from '@/const/topic';
import { router } from '@/libs/trpc/lambda';

import { agentDocumentProcedure, agentDocumentProcedureWrite } from './procedures';

const MAX_METADATA_BYTES = 16 * 1024;

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, {
    message: `metadata must be ${MAX_METADATA_BYTES} bytes or smaller`,
  });

export const documentsRouter = router({
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
   * Get documents for chat context injection.
   */
  getContextDocuments: agentDocumentProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.agentDocumentService.getAgentContextDocuments(input.agentId);
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
   * Return the chat topic that anchors the doc-scoped conversation for this
   * `(documentId, agentId)` pair, creating it idempotently on the first call.
   *
   * Topics are marked with `trigger='document'` so they stay out of the main
   * sidebar history (`MAIN_SIDEBAR_EXCLUDE_TRIGGERS` already excludes them).
   * The mapping is persisted through `topic_documents`, so subsequent calls
   * resolve the same topic id.
   */
  getOrCreateChatTopic: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        documentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.topicModel.findByAgentAndDocumentTrigger({
        agentId: input.agentId,
        documentId: input.documentId,
        trigger: TopicTrigger.Document,
      });
      if (existing) return { topicId: existing.id };

      const document = await ctx.agentDocumentService.findRowByDocumentId(
        input.agentId,
        input.documentId,
      );
      if (!document) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Document not found for agentId=${input.agentId}`,
        });
      }

      const title = document.title || document.filename || 'Document chat';
      const topic = await ctx.topicModel.create({
        agentId: input.agentId,
        title,
        trigger: TopicTrigger.Document,
      });

      await ctx.topicDocumentModel.associate({
        documentId: input.documentId,
        topicId: topic.id,
      });

      return { topicId: topic.id };
    }),
  /**
   * Create or update a document
   */
  upsertDocument: agentDocumentProcedureWrite
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
  deleteDocument: agentDocumentProcedureWrite
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
  deleteAllDocuments: agentDocumentProcedureWrite
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.deleteAllDocuments(input.agentId);
    }),
  /**
   * Initialize documents from a template set
   */
  initializeFromTemplate: agentDocumentProcedureWrite
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
  cloneDocuments: agentDocumentProcedureWrite
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
});
