import { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { MOVE_DOCUMENTS_MAX_IDS } from '@lobechat/builtin-tool-agent-documents';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import {
  agentDocumentProcedure,
  agentDocumentProcedureWrite,
  handleAgentDocumentVfsError,
} from './procedures';

const MAX_RULE_REGEXP_LENGTH = 512;

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

const agentDocumentToolContextSchema = z.object({
  messageId: z.string(),
  operationId: z.string().optional(),
  rootOperationId: z.string().optional(),
  taskId: z.string().nullish(),
  threadId: z.string().nullish(),
  toolCallId: z.string(),
  toolMessageId: z.string().optional(),
  topicId: z.string().optional(),
});

const agentDocumentToolTriggerSchema = z
  .object({
    // REVIEW: @nekomeowww is not fully certain this attribution boundary is clear enough.
    // TODO: Remove this explicit parameter threading if gateway-mode migration makes tool execution fully server-attributed.
    toolContext: agentDocumentToolContextSchema.optional(),
    trigger: z.literal('tool').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.trigger === 'tool' && !value.toolContext) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'toolContext is required when trigger is tool',
        path: ['toolContext'],
      });
    }
  });

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

const emitCreateDocumentToolOutcome = async (input: {
  agentDocumentId?: string;
  agentId: string;
  apiName: string;
  errorReason?: string;
  hintIsSkill?: boolean;
  status: 'failed' | 'succeeded';
  toolContext?: z.infer<typeof agentDocumentToolContextSchema>;
  topicId?: string;
  userId: string;
}) => {
  const { toolContext } = input;

  if (!toolContext) return;

  await emitAgentDocumentToolOutcomeSafely({
    agentDocumentId: input.agentDocumentId,
    agentId: input.agentId,
    apiName: input.apiName,
    errorReason: input.errorReason,
    hintIsSkill: input.hintIsSkill,
    messageId: toolContext.messageId,
    operationId: toolContext.operationId,
    relation: 'created',
    status: input.status,
    summary:
      input.status === 'succeeded'
        ? 'Agent documents created a document.'
        : 'Agent documents failed to create a document.',
    taskId: toolContext.taskId,
    toolAction: 'create',
    toolCallId: toolContext.toolCallId,
    topicId: input.topicId ?? toolContext.topicId,
    userId: input.userId,
  });
};

export const toolDocumentsProcedures = {
  /**
   * Tool-oriented: associate an existing document with an agent
   */
  associateDocument: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        documentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.associateDocument(input.agentId, input.documentId);
    }),
  importFile: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        fileId: z.string(),
        parentId: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.importFile(input.agentId, input.fileId, input.parentId);
    }),
  /**
   * Tool-oriented: create document
   */
  createDocument: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          content: z.string(),
          hintIsSkill: z.boolean().optional(),
          parentId: z.string().optional(),
          title: z.string(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const doc = await ctx.agentDocumentService.createDocument(
          input.agentId,
          input.title,
          input.content,
          {
            hintIsSkill: input.hintIsSkill,
            parentId: input.parentId,
          },
        );

        if (input.trigger === 'tool') {
          await emitCreateDocumentToolOutcome({
            agentDocumentId: doc?.id,
            agentId: input.agentId,
            apiName: 'createDocument',
            hintIsSkill: input.hintIsSkill,
            status: 'succeeded',
            toolContext: input.toolContext,
            userId: ctx.userId,
          });
        }

        return doc;
      } catch (error) {
        if (input.trigger === 'tool') {
          await emitCreateDocumentToolOutcome({
            agentId: input.agentId,
            apiName: 'createDocument',
            errorReason: error instanceof Error ? error.message : String(error),
            hintIsSkill: input.hintIsSkill,
            status: 'failed',
            toolContext: input.toolContext,
            userId: ctx.userId,
          });
        }

        throw error;
      }
    }),
  /**
   * Create an agent document and associate it with a topic in one call.
   * Used by the topic → page flow to create an agent document.
   */
  createForTopic: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          content: z.string(),
          hintIsSkill: z.boolean().optional(),
          parentId: z.string().optional(),
          title: z.string(),
          topicId: z.string(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Use the creator-facing finder: a visitor topic's title must not be
        // copied into a creator-owned document.
        const topic = input.title.trim()
          ? undefined
          : await ctx.topicModel.findOwnTopicById(input.topicId);
        const title = input.title.trim() || topic?.title || '';
        const doc = await ctx.agentDocumentService.createForTopic(
          input.agentId,
          title,
          input.content,
          input.topicId,
          { hintIsSkill: input.hintIsSkill, parentId: input.parentId },
        );

        if (input.trigger === 'tool') {
          await emitCreateDocumentToolOutcome({
            agentDocumentId: doc?.id,
            agentId: input.agentId,
            apiName: 'createForTopic',
            hintIsSkill: input.hintIsSkill,
            status: 'succeeded',
            toolContext: input.toolContext,
            topicId: input.topicId,
            userId: ctx.userId,
          });
        }

        return doc;
      } catch (error) {
        if (input.trigger === 'tool') {
          await emitCreateDocumentToolOutcome({
            agentId: input.agentId,
            apiName: 'createForTopic',
            errorReason: error instanceof Error ? error.message : String(error),
            hintIsSkill: input.hintIsSkill,
            status: 'failed',
            toolContext: input.toolContext,
            topicId: input.topicId,
            userId: ctx.userId,
          });
        }

        throw error;
      }
    }),
  /** Read-only document payload for the standalone Agent Document page. */
  getReaderDocument: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        documentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const grantedPermissions = (ctx as { workspacePermissionCodes?: string[] })
        .workspacePermissionCodes;

      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'view',
          db: ctx.serverDB,
          grantedPermissions,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      const document = await ctx.agentDocumentService.getReaderDocument(
        input.agentId,
        input.documentId,
      );

      if (!document) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent document not found' });
      }

      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'view',
          db: ctx.serverDB,
          grantedPermissions,
          resourceId: input.documentId,
          resourceType: 'document',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      return {
        content: document.content,
        documentId: document.documentId,
        filename: document.filename,
        fileType: document.fileType,
        sourceType: document.sourceType,
        title: document.title,
        updatedAt: document.updatedAt,
      };
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
  modifyNodes: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          id: z.string(),
          operations: z.array(liteXMLOperationSchema).min(1),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.agentDocumentService.modifyDocumentNodesById(
        input.id,
        input.operations,
        input.agentId,
      );

      return doc;
    }),
  /**
   * Tool-oriented: replace document content by id
   */
  replaceDocumentContent: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          content: z.string(),
          id: z.string(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.agentDocumentService.replaceDocumentContentById(
        input.id,
        input.content,
        input.agentId,
      );

      return doc;
    }),
  /**
   * Tool-oriented: remove document by id
   */
  removeDocument: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          id: z.string(),
          // Also delete documents nested under it; without it a parent with
          // children is refused instead of stranding them.
          withChildren: z.boolean().optional(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.agentDocumentService.getDocumentById(input.id, input.agentId);
      const deleted = await ctx.agentDocumentService
        .removeDocumentById(input.id, input.agentId, { withChildren: input.withChildren })
        .catch(handleAgentDocumentVfsError);
      if (deleted && input.trigger === 'tool') {
        await ctx.documentWorkRegistrar.deleteDocumentWork({
          agentDocumentId: input.id,
          agentId: input.agentId,
          documentId: doc?.documentId,
        });
      }

      return { deleted, id: input.id };
    }),
  /**
   * Tool-oriented: copy document by id
   */
  copyDocument: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          id: z.string(),
          newTitle: z.string().optional(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const doc = await ctx.agentDocumentService.copyDocumentById(
          input.id,
          input.newTitle,
          input.agentId,
        );

        return doc;
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: rename document by id
   */
  renameDocument: agentDocumentProcedureWrite
    .input(
      z
        .object({
          agentId: z.string(),
          id: z.string(),
          newTitle: z.string(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const doc = await ctx.agentDocumentService.renameDocumentById(
          input.id,
          input.newTitle,
          input.agentId,
        );

        return doc;
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: create a folder by name, under the root or a parent (folder or document) id
   */
  createFolder: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        parentId: z.string().nullish(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentService.createFolder(
          input.agentId,
          input.title,
          input.parentId,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: move documents/folders by id under a parent (folder or document), or to the root with `null`
   */
  moveDocuments: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        ids: z.array(z.string()).min(1).max(MOVE_DOCUMENTS_MAX_IDS),
        parentId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentService.moveDocuments(
          input.agentId,
          input.ids,
          input.parentId,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: update document load rule by id
   */
  updateLoadRule: agentDocumentProcedureWrite
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
};
