import {
  DOCUMENT_TEMPLATES,
  DocumentLoadFormat,
  DocumentLoadRule,
} from '@lobechat/agent-templates';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { TopicModel } from '@/database/models/topic';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';
import { getUnifiedSkillNamespaceRootPath } from '@/server/services/agentDocumentVfs/mounts/skills/path';

const MAX_METADATA_BYTES = 16 * 1024;
const MAX_RULE_REGEXP_LENGTH = 512;

const agentDocumentVfsErrorToTRPCCode = (
  code: AgentDocumentVfsError['code'],
): 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'METHOD_NOT_SUPPORTED' | 'NOT_FOUND' => {
  switch (code) {
    case 'CONFLICT': {
      return 'CONFLICT';
    }
    case 'FORBIDDEN': {
      return 'FORBIDDEN';
    }
    case 'METHOD_NOT_SUPPORTED': {
      return 'METHOD_NOT_SUPPORTED';
    }
    case 'NOT_FOUND': {
      return 'NOT_FOUND';
    }
    default: {
      return 'BAD_REQUEST';
    }
  }
};

const handleAgentDocumentVfsError = (error: unknown): never => {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof AgentDocumentVfsError) {
    throw new TRPCError({
      cause: error,
      code: agentDocumentVfsErrorToTRPCCode(error.code),
      message: error.message,
    });
  }

  throw error;
};

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
const writeCreateModeSchema = z.enum(['always-new', 'if-missing', 'must-exist']).optional();
const recursiveSchema = z.boolean().optional();
const mountedSkillNamespaceSchema = z.literal('agent');
const agentDocumentToolContextSchema = z.object({
  messageId: z.string(),
  operationId: z.string().optional(),
  taskId: z.string().nullable().optional(),
  toolCallId: z.string(),
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

const createMountedSkillSchema = z.object({
  agentId: z.string(),
  content: z.string(),
  skillName: z.string().min(1),
  targetNamespace: mountedSkillNamespaceSchema,
});

const deleteMountedSkillSchema = z.object({
  agentId: z.string(),
  path: z.string(),
});

const updateMountedSkillSchema = z.object({
  agentId: z.string(),
  content: z.string(),
  path: z.string(),
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

const agentDocumentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentDocumentModel: new AgentDocumentModel(ctx.serverDB, ctx.userId),
      agentDocumentService: new AgentDocumentsService(ctx.serverDB, ctx.userId),
      agentDocumentVfsService: new AgentDocumentVfsService(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
      topicDocumentModel: new TopicDocumentModel(ctx.serverDB, ctx.userId),
    },
  });
});

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
   * Tool-oriented: list documents by VFS path
   */
  listDocumentsByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.list(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          {
            cursor: input.cursor,
            limit: input.limit,
          },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: stat document by VFS path
   */
  statDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.stat(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: read document by VFS path
   */
  readDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.read(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: write document by VFS path
   */
  writeDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        createMode: writeCreateModeSchema,
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.write(
          input.path,
          input.content,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { createMode: input.createMode },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  createSkillByPath: agentDocumentProcedure
    .input(createMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const path = `${getUnifiedSkillNamespaceRootPath(input.targetNamespace)}/${input.skillName}`;

        return await ctx.agentDocumentVfsService.write(
          path,
          input.content,
          {
            agentId: input.agentId,
          },
          { createMode: 'always-new' },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  updateSkillByPath: agentDocumentProcedure
    .input(updateMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.write(
          input.path,
          input.content,
          {
            agentId: input.agentId,
          },
          { createMode: 'must-exist' },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  deleteSkillByPath: agentDocumentProcedure
    .input(deleteMountedSkillSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.delete(input.path, {
          agentId: input.agentId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: create a VFS directory
   */
  mkdirDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.mkdir(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { recursive: input.recursive },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: rename or move a VFS path
   */
  renameDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        fromPath: z.string(),
        toPath: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.rename(
          input.fromPath,
          input.toPath,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { overwrite: input.force },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: copy a VFS path
   */
  copyDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        fromPath: z.string(),
        toPath: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.copy(
          input.fromPath,
          input.toPath,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { overwrite: input.force },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: soft-delete a VFS path
   */
  deleteDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.delete(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { recursive: input.recursive },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: list agent-scoped trash entries
   */
  listTrashDocumentsByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string().optional(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.listTrash(
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          input.path,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: restore a trash entry
   */
  restoreDocumentFromTrashByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.restoreFromTrashByPath(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),

  /**
   * Tool-oriented: permanently remove a trash entry
   */
  deleteDocumentPermanentlyByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.deletePermanentlyByPath(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
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
      z
        .object({
          agentId: z.string(),
          content: z.string(),
          hintIsSkill: z.boolean().optional(),
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
  createForTopic: agentDocumentProcedure
    .input(
      z
        .object({
          agentId: z.string(),
          content: z.string(),
          hintIsSkill: z.boolean().optional(),
          title: z.string(),
          topicId: z.string(),
        })
        .and(agentDocumentToolTriggerSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const topic = input.title.trim() ? undefined : await ctx.topicModel.findById(input.topicId);
        const title = input.title.trim() || topic?.title || '';
        const doc = await ctx.agentDocumentService.createForTopic(
          input.agentId,
          title,
          input.content,
          input.topicId,
          { hintIsSkill: input.hintIsSkill },
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
   * Tool-oriented: replace document content by id
   */
  replaceDocumentContent: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.agentDocumentService.replaceDocumentContentById(
        input.id,
        input.content,
        input.agentId,
      );
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
      try {
        return await ctx.agentDocumentService.copyDocumentById(
          input.id,
          input.newTitle,
          input.agentId,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
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
      try {
        return await ctx.agentDocumentService.renameDocumentById(
          input.id,
          input.newTitle,
          input.agentId,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
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
