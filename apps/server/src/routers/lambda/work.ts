import type {
  RegisterDocumentWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkVersionCumulativeUsage,
} from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { WorkModel } from '@/database/models/work';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const workProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      workModel: new WorkModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const workProcedureWrite = workProcedure.use(withScopedPermission('agent:update'));

const versionRoleSchema = z.enum(['created', 'updated']);

const cumulativeUsageSchema = z.object({
  capturedAt: z.string(),
  cost: z.unknown().optional(),
  usage: z.unknown().optional(),
}) satisfies z.ZodType<WorkVersionCumulativeUsage>;

// Every register* schema must accept `cumulativeCost` / `cumulativeUsage`: the
// client-first runtime stamps the tool call's cumulative cost onto the
// registration (see registerClientWorkFromIntent), and `z.object` strips
// undeclared keys — omitting them here silently stores cost-less versions.
const registerTaskSchema = z.object({
  actorAgentId: z.string().nullable().optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  role: versionRoleSchema,
  rootOperationId: z.string().nullable().optional(),
  source: z.string().min(1),
  sourceMessageId: z.string().nullable().optional(),
  sourceToolCallId: z.string().nullable().optional(),
  taskId: z.string().optional(),
  taskIdentifier: z.string().optional(),
  threadId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterTaskWorkParams>;

const registerSkillToolResultSchema = z.object({
  actorAgentId: z.string().nullable().optional(),
  args: z.record(z.unknown()).optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  data: z.unknown().optional(),
  provider: z.string().min(1),
  rootOperationId: z.string().nullable().optional(),
  sourceMessageId: z.string().nullable().optional(),
  sourceToolCallId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  toolName: z.string().min(1),
  topicId: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterSkillToolResultWorkParams>;

const registerDocumentSchema = z.object({
  actorAgentId: z.string().nullable().optional(),
  agentDocumentId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  documentId: z.string().min(1),
  role: versionRoleSchema,
  rootOperationId: z.string().nullable().optional(),
  source: z.string().min(1),
  sourceMessageId: z.string().nullable().optional(),
  sourceToolCallId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterDocumentWorkParams>;

export const workRouter = router({
  listByConversation: workProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        threadId: z.string().nullable().optional(),
        topicId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => ctx.workModel.listByConversation(input)),

  listByWorkspace: workProcedure
    .input(
      z.object({
        cursor: z.string().nullable().optional(),
        limit: z.number().min(1).max(100).default(30),
        type: z.enum(['task', 'document', 'linear', 'github']).nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => ctx.workModel.listByWorkspace(input)),

  listByRootOperation: workProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        rootOperationId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.workModel.listByRootOperation({
        limit: input.limit,
        rootOperationId: input.rootOperationId,
      }),
    ),

  listByRootOperations: workProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        rootOperationIds: z.array(z.string()).nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.workModel.listByRootOperations({
        limit: input.limit,
        rootOperationIds: input.rootOperationIds,
      }),
    ),

  listVersions: workProcedure
    .input(z.object({ workId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ctx.workModel.listVersions(input.workId)),

  deleteTaskWork: workProcedureWrite
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ctx.workModel.deleteTaskWork(input)),

  registerTask: workProcedureWrite
    .input(registerTaskSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerTask(input)),

  registerDocument: workProcedureWrite
    .input(registerDocumentSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerDocument(input)),

  handleSkillToolResult: workProcedureWrite
    .input(registerSkillToolResultSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.handleSkillToolResult(input)),
});
