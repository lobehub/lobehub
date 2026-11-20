import {
  type RegisterCanvasWorkParams,
  type RegisterDocumentWorkParams,
  type RegisterSkillToolResultWorkParams,
  type RegisterTaskWorkParams,
  WORK_SKILL_PROVIDERS,
  type WorkVersionCumulativeUsage,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createCanvasStorageService, isOwnCanvasManifestKey } from '@/server/services/canvas';
import { deleteCanvas } from '@/server/services/canvas/delete';
import {
  isBetterCodingExperienceEnabled,
  linkPushedPullRequests,
  linkTopicPullRequest,
  listTopicPullRequestsWithStatus,
  parsePullRequestUrl,
  registerShellWorksForLocalRun,
  resolveShellPullRequestLinking,
  setTopicPullRequestDismissed,
} from '@/server/services/workRegistration';

import {
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
} from './_helpers/conversationResourceGuard';
import { batchResolveAgentIdFromSessions } from './_helpers/resolveContext';

const topicGuardCtx = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => ({ db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId });

const workProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
      workModel: new WorkModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const lookupPullRequestInput = z.object({ url: z.string().trim().min(1).max(2048) });

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

const registerCanvasSchema = z.object({
  agentId: z.string().nullable().optional(),
  canvasId: z.string().min(1),
  cumulativeCost: z.number().nullable().optional(),
  cumulativeUsage: cumulativeUsageSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  metadata: z.object({
    entry: z.string().min(1),
    fileCount: z.number().int().nonnegative(),
    manifestKey: z.string().min(1),
    runtimeMajor: z.number().int().positive(),
    totalSize: z.number().int().nonnegative(),
  }),
  rootOperationId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  title: z.string().min(1),
  toolCallId: z.string().nullable().optional(),
  toolIdentifier: z.string().min(1),
  toolName: z.string().min(1),
  topicId: z.string().nullable().optional(),
}) satisfies z.ZodType<RegisterCanvasWorkParams>;

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
        // Opt-in for the `file` work type. Absent → the legacy (pre-`file`) set,
        // so already-deployed clients whose descriptor table lacks `file` never
        // receive it (see resolveAllowedWorkTypes in the work registry).
        includeFileWorks: z.boolean().optional(),
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
        includeFileWorks: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(30),
        originAgentId: z.string().nullable().optional(),
        provider: z.enum(WORK_SKILL_PROVIDERS).optional(),
        type: z.enum(['task', 'document', 'external', 'file', 'canvas']).nullable().optional(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => ctx.workModel.listByWorkspace(input)),

  listByRootOperation: workProcedure
    .input(
      z.object({
        includeFileWorks: z.boolean().optional(),
        limit: z.number().min(1).max(50).default(20),
        rootOperationId: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.workModel.listByRootOperation({
        includeFileWorks: input.includeFileWorks,
        limit: input.limit,
        rootOperationId: input.rootOperationId,
      }),
    ),

  listByRootOperations: workProcedure
    .input(
      z.object({
        includeFileWorks: z.boolean().optional(),
        limit: z.number().min(1).max(50).default(20),
        rootOperationIds: z.array(z.string()).max(100).nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.workModel.listByRootOperations({
        includeFileWorks: input.includeFileWorks,
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

  // User-initiated removal of an orphaned Work card. The Work is polymorphic,
  // so this takes the general `agent:update` workspace-write gate (the same one
  // Work, project and goal mutations use) rather than a per-resource gate; the
  // model further restricts the delete to the caller's own rows whose backing
  // task / document is already gone, so a live Work cannot be removed here.
  deleteWork: skillWorkProcedureWrite
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // A canvas Work is the canvas itself: delete it the one way that also
      // takes its public site offline and frees its files.
      const canvasId = await ctx.workModel.findCanvasIdByWorkId(input.id);
      if (canvasId) {
        await deleteCanvas(canvasId, {
          db: ctx.serverDB,
          storage: createCanvasStorageService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ),
          userId: ctx.userId,
          workModel: ctx.workModel,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return;
      }

      await ctx.workModel.deleteWork(input);
    }),

  registerTask: taskWorkProcedureWrite
    .input(registerTaskSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerTask(input)),

  registerCanvas: skillWorkProcedureWrite
    .input(registerCanvasSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isOwnCanvasManifestKey(ctx.userId, input.metadata.manifestKey)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Canvas manifest is not yours' });
      }
      return ctx.workModel.registerCanvas(input);
    }),

  registerDocument: documentWorkProcedureWrite
    .input(registerDocumentSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.registerDocument(input)),

  handleSkillToolResult: skillWorkProcedureWrite
    .input(registerSkillToolResultSchema)
    .mutation(async ({ ctx, input }) => ctx.workModel.handleSkillToolResult(input)),

  // Completion-time shell Work scan for desktop-LOCAL hetero runs (Claude
  // Code / Codex with execution target `local`). Those runs create no
  // `agent_operations` row and never call `heteroFinish`, so the server-side
  // completion scan (`registerWorksForOperation`) structurally cannot fire —
  // the client executor reports the run's persisted tool message ids here
  // instead. Everything is re-read ownership- and topic-scoped from the DB, so
  // the caller can only ever scan rows it already owns. Same write gate as the
  // other external-provider registrations.
  registerShellWorksForRun: skillWorkProcedureWrite
    .input(
      z.object({
        anchorMessageId: z.string().min(1),
        messageIds: z.array(z.string()).min(1).max(500),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      registerShellWorksForLocalRun({
        anchorMessageId: input.anchorMessageId,
        messageIds: input.messageIds,
        messageModel: ctx.messageModel,
        pullRequestLinking: await resolveShellPullRequestLinking({
          db: ctx.serverDB,
          topicId: input.topicId,
          userId: ctx.userId,
          workModel: ctx.workModel,
          workspaceId: ctx.workspaceId,
        }),
        topicId: input.topicId,
        workModel: ctx.workModel,
      }),
    ),

  // Better Coding Experience: the GitHub pull requests a topic's Work rows
  // link, with the GitHub App's state where an installation tracks the repo.
  listTopicPullRequests: workProcedure
    .input(z.object({ topicId: z.string().min(1) }))
    .query(async ({ ctx, input }) =>
      listTopicPullRequestsWithStatus({
        db: ctx.serverDB,
        topicId: input.topicId,
        topicModel: ctx.topicModel,
        userId: ctx.userId,
        workModel: ctx.workModel,
        workspaceId: ctx.workspaceId,
      }),
    ),

  lookupPullRequest: workProcedure.input(lookupPullRequestInput).query(async ({ ctx, input }) => {
    const pr = parsePullRequestUrl(input.url);
    if (!pr) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Expected a GitHub pull request URL, e.g. https://github.com/owner/repo/pull/123',
      });
    }

    const topics = await ctx.workModel.listTopicsByPullRequest(pr.identifier);
    const guardCtx = topicGuardCtx(ctx);
    const accessByTarget = new Map<string, Promise<boolean>>();
    const canView = (topic: (typeof topics)[number]) => {
      const key = JSON.stringify([topic.agentId, topic.groupId, topic.sessionId]);
      const cached = accessByTarget.get(key);
      if (cached) return cached;
      const access = assertCanViewTopicTargets(guardCtx, [topic.topicId]).then(
        () => true,
        (error: unknown) => {
          if (error instanceof TRPCError && error.code === 'FORBIDDEN') return false;
          throw error;
        },
      );
      accessByTarget.set(key, access);
      return access;
    };
    const visible = ctx.workspaceId
      ? (
          await pMap(topics, async (topic) => ((await canView(topic)) ? [topic] : []), {
            concurrency: 10,
          })
        ).flat()
      : topics;

    const legacySessionIds = visible.flatMap(({ agentId, groupId, sessionId }) =>
      !agentId && !groupId && sessionId ? [sessionId] : [],
    );
    const sessionAgentIds = await batchResolveAgentIdFromSessions(
      [...new Set(legacySessionIds)],
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    return {
      data: visible.map(({ sessionId, ...topic }) => ({
        ...topic,
        agentId: topic.agentId ?? (sessionId && sessionAgentIds.get(sessionId)) ?? null,
      })),
      success: true,
    };
  }),

  // Better Coding Experience: link the pull requests a `git push` tool call
  // updated, right after it ran. The push itself is re-read from the persisted
  // tool message; see `linkPushedPullRequests` for what the device may add.
  linkPushedPullRequests: skillWorkProcedureWrite
    .input(
      z.object({
        pullRequests: z
          .array(
            z.object({
              headRefName: z.string().min(1).max(255),
              headRepoFullName: z.string().max(255).optional(),
              isDraft: z.boolean().optional(),
              number: z.number().int().positive(),
              state: z.string().max(32).optional(),
              title: z.string().max(1024).optional(),
              url: z.string().url().max(2048),
            }),
          )
          .max(10),
        toolCallId: z.string().min(1).max(255),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      linkPushedPullRequests({
        db: ctx.serverDB,
        devicePullRequests: input.pullRequests,
        messageModel: ctx.messageModel,
        toolCallId: input.toolCallId,
        topicId: input.topicId,
        userId: ctx.userId,
        workModel: ctx.workModel,
        workspaceId: ctx.workspaceId,
      }),
    ),

  // Better Coding Experience: keep a PR on the topic itself — found on the
  // topic's own branch at run end (`branch`), or pasted by the person
  // (`manual`). A topic link only drives the topic's PR lists: unlike a Work
  // row it is never read by the SCM links, so a client-named PR cannot make a
  // merge accept a delivery or a CI failure wake the agent.
  linkTopicPullRequest: workProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        headRefName: z.string().max(255).optional(),
        source: z.enum(['branch', 'manual']),
        title: z.string().max(1024).optional(),
        topicId: z.string().min(1),
        url: z.string().max(2048),
        /** Branch matches only: the PR's head lives in the repo the topic pushes to. */
        vouched: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Same gate as topic.updateTopicMetadata: `use` access to the conversation.
      await assertCanUseTopicTargets(topicGuardCtx(ctx), [input.topicId]);
      const parsed = parsePullRequestUrl(input.url);
      if (!parsed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a GitHub pull request URL' });
      }
      if (!(await isBetterCodingExperienceEnabled(ctx.serverDB, ctx.userId))) {
        return { identifier: parsed.identifier, linked: false };
      }
      const linked = await linkTopicPullRequest(ctx.topicModel, input.topicId, {
        ...(input.headRefName ? { headRefName: input.headRefName } : {}),
        identifier: parsed.identifier,
        source: input.source,
        ...(input.title ? { title: input.title } : {}),
        url: parsed.url,
        // The person vouches for what they link by hand.
        vouched: input.source === 'manual' ? true : !!input.vouched,
      });
      return { identifier: parsed.identifier, linked };
    }),

  // Better Coding Experience: remove a PR from the topic's lists (or bring it
  // back). Its Work rows stay; only the topic's view of them changes.
  setTopicPullRequestDismissed: workProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        dismissed: z.boolean(),
        identifier: z.string().regex(/^[\w.-]+\/[\w.-]+#\d+$/),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanUseTopicTargets(topicGuardCtx(ctx), [input.topicId]);
      return {
        updated: await setTopicPullRequestDismissed(
          ctx.topicModel,
          input.topicId,
          input.identifier,
          input.dismissed,
        ),
      };
    }),
});
