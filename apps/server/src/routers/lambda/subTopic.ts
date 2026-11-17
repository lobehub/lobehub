import type { OpenedSubTopic, SubTopicDetachResult, SubTopicRetireResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  assertCanUseTopicTargets,
  assertCanViewConversationTargets,
  assertCanViewTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { AiAgentService } from '@/server/services/aiAgent';
import { startComposerRun } from '@/server/services/aiAgent/composerRun';
import { resolveForegroundInterventionConfig } from '@/server/services/aiAgent/foregroundIntervention';
import {
  findOwnLiveRuns,
  findTopicsRunByOthers,
} from '@/server/services/aiAgent/steerQueue/liveRuns';
import {
  RETIRED_TOPIC_STATUSES,
  SubTopicError,
  SubTopicService,
  toSubTopicState,
} from '@/server/services/subTopic';
import { issueWorktreeReceipt } from '@/server/services/worktreeCleanup/receipt';

import { agentSteerQueueRouter } from './agentSteerQueue';
import { assertCanUseAgentRunConversation } from './aiAgent/guards';
import { deviceRouter } from './device';
import { topicRouter } from './topic';
import { readTopicTranscript } from './topic/transcript';

/**
 * Sub-topics (`metadata.openedBy`): the sidebar hierarchy, the archive /
 * trash / move-to-top-level flows, and the `lobe-topic` tool and
 * `lh topic` commands. Every write goes through the app's existing entry
 * (`aiAgent.execAgent`, the steer queue, `topic.updateTopic`,
 * `topic.removeTopic`), called with this request's own context.
 */

interface CallerCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: null | string;
}

const LAST_REPLY_WINDOW = 20;

/** Concurrent agent display-field reads behind one sidebar listing. */
const AGENT_FIELDS_CONCURRENCY = 10;

/** Concurrent per-agent view checks behind one sidebar listing. */
const VIEW_CHECK_CONCURRENCY = 5;

export const createSubTopicService = (ctx: CallerCtx) => {
  const db = ctx.serverDB;
  const workspaceId = ctx.workspaceId ?? undefined;
  const callerCtx = ctx as any;
  const topicModel = new TopicModel(db, ctx.userId, workspaceId);
  const messageModel = new MessageModel(db, ctx.userId, workspaceId);
  const topicCaller = () => topicRouter.createCaller(callerCtx);
  const guard = { db, userId: ctx.userId, workspaceId };

  return new SubTopicService({
    addGitWorktree: async (params) =>
      (await deviceRouter
        .createCaller(callerCtx)
        .addGitWorktree({ ...params, stripBranchPrefix: true })) as {
        error?: string;
        ownerToken?: string;
        success: boolean;
        worktreePath?: string;
      },
    appendFollowUp: (params) =>
      agentSteerQueueRouter.createCaller(callerCtx).append(params as any) as Promise<{
        queued: boolean;
        reason?: string;
      }>,
    archiveTopic: (topicId) =>
      topicCaller().updateTopic({
        id: topicId,
        value: { completedAt: new Date(), status: 'completed' },
      }),
    // The checks `aiAgent.execAgent` runs before a send: the target agent, and
    // the conversation the new topic hangs off.
    assertCanOpen: async ({ agentId, openerTopicId }) => {
      await assertCanUseWorkspaceAgent({ agentId, db, userId: ctx.userId, workspaceId });
      await assertCanUseAgentRunConversation({
        db,
        openedByTopicId: openerTopicId,
        userId: ctx.userId,
        workspaceId,
      });
    },
    assertCanEditTopics: async (topicIds) => {
      await assertCanUseTopicTargets(guard, topicIds);
    },
    assertCanViewTopics: async (topicIds) => {
      await assertCanViewTopicTargets(guard, topicIds);
    },
    filterViewableAgents: async (agentIds) => {
      // Outside a workspace every agent here is the caller's own.
      if (!workspaceId) return new Set(agentIds);
      const allowed = await pMap(
        agentIds,
        (agentId) =>
          assertCanViewConversationTargets(guard, [{ agentId }]).then(
            () => agentId,
            () => undefined,
          ),
        { concurrency: VIEW_CHECK_CONCURRENCY },
      );
      return new Set(allowed.filter(Boolean) as string[]);
    },
    detachTopics: (topicIds) => topicModel.detachOpenedTopics(topicIds),
    execAgent: (params) =>
      new AiAgentService(db, ctx.userId, { workspaceId }).execAgent(params as any),
    findLiveRunIds: (topicId) =>
      findOwnLiveRuns({ db, workspaceId }, { threadId: null, topicId, userId: ctx.userId }),
    findTopicsRunByOthers: (topicIds) =>
      findTopicsRunByOthers({ db, workspaceId }, { topicIds, userId: ctx.userId }),
    findLatestRunStatus: (topicId) => topicModel.getLatestRunStatus(topicId),
    findTopic: (topicId) => topicModel.findById(topicId) as any,
    issueWorktreeReceipt: () => issueWorktreeReceipt(ctx.userId),
    interrupt: (operationId) =>
      new AiAgentService(db, ctx.userId, { workspaceId }).interruptTask({ operationId }),
    listDescendants: (topicId) =>
      topicModel.listOpenedDescendants(topicId, { excludeStatuses: RETIRED_TOPIC_STATUSES }),
    listOpened: (openerTopicIds) =>
      topicModel.listOpenedTopics({ excludeStatuses: RETIRED_TOPIC_STATUSES, openerTopicIds }),
    listOpenedTree: (openerTopicIds) =>
      topicModel.listOpenedTopics({
        excludeStatuses: RETIRED_TOPIC_STATUSES,
        includeDescendants: true,
        openerTopicIds,
      }),
    readLastReply: async (topicId) => {
      const { total } = await messageModel.queryTopicTranscript({ limit: 1, offset: 0, topicId });
      const { items } = await messageModel.queryTopicTranscript({
        limit: LAST_REPLY_WINDOW,
        offset: Math.max(0, (total ?? 0) - LAST_REPLY_WINDOW),
        topicId,
      });
      const last = [...items]
        .reverse()
        .find((item: any) => item.role === 'assistant' && typeof item.content === 'string');
      const content = (last as { content?: string } | undefined)?.content?.trim();
      return content ? content.slice(0, 2000) : undefined;
    },
    readTranscript: (params) =>
      readLatestSubTopicTranscript({ db, userId: ctx.userId, workspaceId }, params),
    resolveInterventionConfig: () => resolveForegroundInterventionConfig(db, ctx.userId),
    rollbackWorktree: async ({ branch, deviceId, repoPath, worktreePath }) => {
      try {
        // A topic that already points at it owns it now: its cleanup decides.
        if (
          (await topicModel.countLiveTopicsUsingWorktree({ excludeIds: [], path: worktreePath })) >
          0
        )
          return;
        const device = deviceRouter.createCaller(callerCtx);
        const removed = await device.removeGitWorktree({ deviceId, path: repoPath, worktreePath });
        if (!removed.success) return;
        // The branch was cut for this run and never used: drop it with the folder.
        await device.deleteGitBranch({ branch, deviceId, path: repoPath });
      } catch (error) {
        console.error('[subTopic] rolling back worktree %s failed: %O', worktreePath, error);
      }
    },
    // What `aiAgent.execAgent` does for a non-superseding send; the steer-queue
    // append just before it already authorized this agent and conversation.
    startOnTopic: (params) =>
      startComposerRun(
        {
          aiAgentService: new AiAgentService(db, ctx.userId, { workspaceId }),
          db,
          supersedeLiveRun: false,
          userId: ctx.userId,
          workspaceId,
        },
        { ...(params as any), queuedSuccessor: true },
      ) as any,
    // Same default as the delete confirmation: the topic's uploaded files go with it.
    trashTopic: (topicId, { removeFiles }) =>
      topicCaller().removeTopic({ id: topicId, removeFiles }),
  });
};

/** A page of a sub-topic's transcript; without `offset`, its latest page. */
export const readLatestSubTopicTranscript = async (
  scope: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  input: { limit: number; offset?: number; topicId: string },
) => {
  let offset = input.offset;
  if (offset === undefined) {
    const head = await readTopicTranscript(scope, {
      includeMessages: true,
      limit: 1,
      offset: 0,
      topicId: input.topicId,
    });
    offset = Math.max(0, (head.total ?? 0) - input.limit);
  }
  return readTopicTranscript(scope, {
    includeMessages: true,
    limit: input.limit,
    offset,
    topicId: input.topicId,
  });
};

/** Name the agents a move sent sub-topics back to, for the "moved to …" notice. */
const withAgentTitles = async <T extends { agentId: null | string }>(
  ctx: CallerCtx,
  rows: T[],
): Promise<(T & { agentTitle: null | string })[]> => {
  const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
  const ids = [...new Set(rows.map((row) => row.agentId).filter(Boolean))] as string[];
  const titles = new Map<string, null | string>();
  for (const id of ids) {
    const fields = await agentModel.getAgentDisplayFields(id).catch(() => undefined);
    titles.set(id, fields?.title ?? fields?.name ?? null);
  }
  return rows.map((row) => ({
    ...row,
    agentTitle: row.agentId ? (titles.get(row.agentId) ?? null) : null,
  }));
};

/** Map a service refusal onto the tRPC error the caller sees. */
const run = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SubTopicError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
};

const subTopicProcedure = wsCompatProcedure.use(serverDatabase);

const workspaceSchema = z.enum(['inherit', 'new-worktree', 'none']);

export const subTopicRouter = router({
  archive: subTopicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ mode: z.enum(['all', 'self']), topicId: z.string() }))
    .mutation(({ ctx, input }) =>
      run(async (): Promise<SubTopicRetireResult> => {
        const result = await createSubTopicService(ctx).retire({
          action: 'archive',
          mode: input.mode,
          topicId: input.topicId,
        });
        return { ...result, detached: await withAgentTitles(ctx, result.detached) };
      }),
    ),

  detach: subTopicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ topicIds: z.array(z.string()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      run(async (): Promise<SubTopicDetachResult> => {
        const result = await createSubTopicService(ctx).detach(input.topicIds);
        return { detached: await withAgentTitles(ctx, result.detached) };
      }),
    ),

  describe: subTopicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(({ ctx, input }) => run(() => createSubTopicService(ctx).describe(input.topicId))),

  get: subTopicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(({ ctx, input }) => run(() => createSubTopicService(ctx).get(input.topicId))),

  /** Whether `topicId` is a live sub-topic (any depth) of `openerTopicId` — the tool's scope check. */
  isOpenedBy: subTopicProcedure
    .input(z.object({ openerTopicId: z.string(), topicId: z.string() }))
    .query(({ ctx, input }) =>
      run(() => createSubTopicService(ctx).isOpenedBy(input.topicId, input.openerTopicId)),
    ),

  list: subTopicProcedure
    .input(z.object({ openerTopicId: z.string() }))
    .query(({ ctx, input }) => run(() => createSubTopicService(ctx).list(input.openerTopicId))),

  /**
   * The sidebar's hierarchy: every live sub-topic under `openerTopicIds`
   * (and theirs, so a grandchild can attach to the topmost visible opener),
   * with each one's agent for the cross-agent avatar.
   */
  listOpened: subTopicProcedure
    .input(z.object({ openerTopicIds: z.array(z.string()).max(200) }))
    .query(async ({ ctx, input }): Promise<OpenedSubTopic[]> => {
      const workspaceId = ctx.workspaceId ?? undefined;
      // Only sub-topics whose agent the caller may view (and nothing below a hidden one).
      const rows = await createSubTopicService(ctx).listTree(input.openerTopicIds);
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, workspaceId);
      const agentIds = [...new Set(rows.map((row) => row.agentId).filter(Boolean))] as string[];
      // One display-field read per distinct agent, a bounded few at a time.
      const agents = Object.fromEntries(
        await pMap(
          agentIds,
          async (agentId) => {
            const fields = await agentModel.getAgentDisplayFields(agentId).catch(() => undefined);
            return [
              agentId,
              {
                avatar: fields?.avatar ?? null,
                backgroundColor: (fields as any)?.backgroundColor ?? null,
                title: fields?.title ?? fields?.name ?? null,
              },
            ] as const;
          },
          { concurrency: AGENT_FIELDS_CONCURRENCY },
        ),
      );

      return rows.map((row) => ({
        agent: row.agentId ? agents[row.agentId] : undefined,
        agentId: row.agentId,
        id: row.id,
        openedBy: row.openedBy,
        runStartedAt: row.runStartedAt,
        state: toSubTopicState(row.status, row.latestRunStatus),
        status: row.status,
        taskId: row.taskId,
        title: row.title,
        trigger: row.trigger,
        updatedAt: row.updatedAt,
      }));
    }),

  read: subTopicProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(30),
        offset: z.number().int().min(0).optional(),
        topicId: z.string(),
      }),
    )
    .query(({ ctx, input }) =>
      run(() =>
        createSubTopicService(ctx).read(input.topicId, {
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    ),

  send: subTopicProcedure
    // Starts a run that writes the user message: the same scoped permission
    // `aiAgent.execAgent` / `agentSteerQueue.append` require.
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        message: z.string().min(1),
        sourceOperationId: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => run(() => createSubTopicService(ctx).send(input))),

  open: subTopicProcedure
    // Starts a run that writes the user message: the same scoped permission
    // `aiAgent.execAgent` / `agentSteerQueue.append` require.
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        agentId: z.string().optional(),
        baseBranch: z.string().optional(),
        deviceId: z.string().optional(),
        detach: z.boolean().optional(),
        openerTopicId: z.string(),
        prompt: z.string().min(1),
        sourceOperationId: z.string().optional(),
        title: z.string().max(255).optional(),
        workspace: workspaceSchema.optional(),
      }),
    )
    // Not lab-gated: `lh topic send --new` opens sub-topics with the lab off too;
    // only the lobe-topic tool and the UI are.
    .mutation(({ ctx, input }) => run(() => createSubTopicService(ctx).open(input))),

  stop: subTopicProcedure
    .input(z.object({ topicId: z.string() }))
    .mutation(({ ctx, input }) => run(() => createSubTopicService(ctx).stop(input.topicId))),

  trash: subTopicProcedure
    .use(withScopedPermission('topic:delete'))
    .input(
      z.object({
        mode: z.enum(['all', 'self']),
        /** Also delete uploads only these topics reference; the delete confirm's default is yes. */
        removeFiles: z.boolean().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      run(async (): Promise<SubTopicRetireResult> => {
        const result = await createSubTopicService(ctx).retire({
          action: 'trash',
          mode: input.mode,
          removeFiles: input.removeFiles,
          topicId: input.topicId,
        });
        return { ...result, detached: await withAgentTitles(ctx, result.detached) };
      }),
    ),
});
