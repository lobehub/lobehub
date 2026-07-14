import {
  type RegisterDocumentWorkParams,
  type RegisterSkillToolResultWorkParams,
  type RegisterTaskWorkParams,
  WORK_SKILL_PROVIDERS,
  type WorkVersionCumulativeUsage,
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

// Task-domain write gate. Task mutations elsewhere (see the task router's
// `taskProcedureWrite`) gate on `agent:update`, so a Work registration that
// records a task mutation must require the same permission — otherwise a role
// that can't mutate tasks could still forge (or be denied) task provenance.
const taskWorkProcedureWrite = workProcedure.use(withScopedPermission('agent:update'));

// Document-domain write gate. Document mutations (see the document router)
// gate on `document:update`; the document Work registration is the provenance
// side of the same mutation and must align, so a role with `agent:update` but
// without `document:update` can't forge document provenance, and a document-only
// role's legitimate registration isn't rejected.
const documentWorkProcedureWrite = workProcedure.use(withScopedPermission('document:update'));

// Skill tool results (external skill providers, e.g. linear/github) touch no
// first-class workspace resource with its own permission domain, so there is no
// narrower gate to align with; keep the general `agent:update` workspace-write gate.
const skillWorkProcedureWrite = workProcedure.use(withScopedPermission('agent:update'));

const versionChangeTypeSchema = z.enum(['created', 'updated']);

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
  agentId: z.string().nullable().optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  changeType: versionChangeTypeSchema,
  messageId: z.string().nullable().optional(),
  rootOperationId: z.string().nullable().optional(),
  taskId: z.string().optional(),
  taskIdentifier: z.string().optional(),
  threadId: z.string().nullable().optional(),
  toolCallId: z.string().nullable().optional(),
  toolIdentifier: z.string().min(1),
  toolName: z.string().min(1),
  topicId: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterTaskWorkParams>;

const registerSkillToolResultSchema = z.object({
  agentId: z.string().nullable().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  data: z.unknown().optional(),
  messageId: z.string().nullable().optional(),
  provider: z.string().min(1),
  rootOperationId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  toolCallId: z.string().nullable().optional(),
  toolName: z.string().min(1),
  topicId: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterSkillToolResultWorkParams>;

const registerDocumentSchema = z.object({
  agentDocumentId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  documentId: z.string().min(1),
  changeType: versionChangeTypeSchema,
  messageId: z.string().nullable().optional(),
  rootOperationId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  toolCallId: z.string().nullable().optional(),
  toolIdentifier: z.string().min(1),
  toolName: z.string().min(1),
  topicId: z.string().nullable().optional(),
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
        provider: z.enum(WORK_SKILL_PROVIDERS).optional(),
        type: z.enum(['task', 'document', 'external']).nullable().optional(),
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
        rootOperationIds: z.array(z.string()).max(100).nullable().optional(),
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

  deleteTaskWork: taskWorkProcedureWrite
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ctx.workModel.deleteTaskWork(input)),

  registerTask: taskWorkProcedureWrite
    .input(registerTaskSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerTask(input)),

  registerDocument: documentWorkProcedureWrite
    .input(registerDocumentSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerDocument(input)),

  handleSkillToolResult: skillWorkProcedureWrite
    .input(registerSkillToolResultSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.handleSkillToolResult(input)),
});
