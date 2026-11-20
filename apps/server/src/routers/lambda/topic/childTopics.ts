import type {
  AgentOperationStatus,
  ChatTopicStatus,
  OpenedSubTopic,
  OpenedTopicItem,
  SubTopicState,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import type { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { AiAgentService } from '@/server/services/aiAgent';
import {
  findOwnLiveRuns,
  findTopicsRunByOthers,
} from '@/server/services/aiAgent/steerQueue/liveRuns';
import { TopicArchiveService } from '@/server/services/topicArchive';
import type { TrashService } from '@/server/services/trash';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import {
  assertCanUseTopicTargets,
  assertCanViewConversationTargets,
} from '../_helpers/conversationResourceGuard';
import { assertCreatorTopicTargets } from '../_helpers/shareVisitorTargetGuard';
import { guardCtx, topicProcedure } from './procedures';

/**
 * Sub-topics are ordinary topics with a parent (`metadata.openedBy`, written
 * by `aiAgent.execAgent({ openedByTopicId })`). What a parent adds lives here,
 * on the topic router: the tree of its children (`listChildTopics`), and what
 * happens to them when the parent is archived or deleted
 * (`updateTopic` / `removeTopic` with `childTopics`) or one is moved to the
 * top level (`updateTopic` with `detachFromParent`).
 */

/** Statuses that take a topic out of the sidebar (archive writes `completed`). */
export const RETIRED_TOPIC_STATUSES: ChatTopicStatus[] = ['completed', 'archived'];

/** What to do with a topic's sub-topics when it is archived or deleted. */
export const childTopicsModeSchema = z.enum(['all', 'detach']);
export type ChildTopicsMode = z.infer<typeof childTopicsModeSchema>;

/** Concurrent agent display-field reads behind one tree listing. */
const AGENT_FIELDS_CONCURRENCY = 10;

/**
 * What a sub-topic is doing. The latest top-level operation wins while it is
 * in flight or failed — a server-run turn never writes `topics.status` — and
 * the topic's own status (archive, a client run) decides otherwise.
 */
export const toSubTopicState = (
  status: ChatTopicStatus | null | undefined,
  latestRunStatus?: AgentOperationStatus | null,
): SubTopicState => {
  if (status === 'completed' || status === 'archived') return 'archived';
  switch (latestRunStatus) {
    case 'waiting_for_human': {
      return 'waiting_for_user';
    }
    case 'idle':
    case 'running':
    case 'waiting_for_async_tool':
    case 'waiting_for_client': {
      return 'running';
    }
    case 'error': {
      return 'failed';
    }
  }
  switch (status) {
    case 'running': {
      return 'running';
    }
    case 'waitingForHuman': {
      return 'waiting_for_user';
    }
    case 'failed': {
      return 'failed';
    }
    default: {
      return 'idle';
    }
  }
};

/**
 * The descendants an "archive / delete all" takes along: everything except
 * task runs and whatever they opened. A task run belongs to its task, which
 * keeps running it and reads its topic; retiring a conversation must not stop
 * or remove it.
 */
export const retirableDescendants = (rootId: string, descendants: OpenedTopicItem[]) => {
  const kept = new Set<string>([rootId]);
  const result: OpenedTopicItem[] = [];
  let pending = descendants;
  // Parents usually arrive before children (breadth-first walk); repeat until nothing moves.
  while (pending.length > 0) {
    const next: OpenedTopicItem[] = [];
    for (const item of pending) {
      const parent = item.openedBy?.topicId;
      if (!parent || !kept.has(parent)) {
        next.push(item);
        continue;
      }
      if (item.trigger === 'task') continue;
      kept.add(item.id);
      result.push(item);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return result;
};

interface ChildTopicsCtx {
  serverDB: LobeChatDatabase;
  topicModel: TopicModel;
  trashService: TrashService;
  userId: string;
  workspaceId?: null | string;
  workspaceRole?: null | string;
}

/** Drop children whose agent the caller may not view, and everything below them. */
export const onlyViewableChildTopics = async (
  guard: ReturnType<typeof guardCtx>,
  rows: OpenedTopicItem[],
) => {
  if (!guard.workspaceId) return rows;
  const agentIds = [...new Set(rows.map((row) => row.agentId).filter(Boolean))] as string[];
  const viewable = new Set<string>();
  for (const agentId of agentIds) {
    try {
      await assertCanViewConversationTargets(guard, [{ agentId }]);
      viewable.add(agentId);
    } catch {
      // Another member's private agent: left out.
    }
  }
  const hidden = new Set(
    rows.filter((row) => row.agentId && !viewable.has(row.agentId)).map((row) => row.id),
  );
  // Rows are not in tree order: repeat until no more children of hidden rows turn up.
  let grew = hidden.size > 0;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (!hidden.has(row.id) && row.openedBy?.topicId && hidden.has(row.openedBy.topicId)) {
        hidden.add(row.id);
        grew = true;
      }
    }
  }
  return rows.filter((row) => !hidden.has(row.id));
};

/** Cancel every live run of `topicIds`; refuse when one cannot be confirmed stopped. */
const interruptAll = async (ctx: ChildTopicsCtx, topicIds: string[]) => {
  const workspaceId = ctx.workspaceId ?? undefined;
  const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId });
  let unconfirmed = 0;
  for (const topicId of topicIds) {
    const runIds = await findOwnLiveRuns(
      { db: ctx.serverDB, workspaceId },
      { threadId: null, topicId, userId: ctx.userId },
    );
    for (const operationId of runIds) {
      const result = await aiAgentService.interruptTask({ operationId, topicId });
      if (!result.success) unconfirmed += 1;
    }
  }
  if (unconfirmed > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${unconfirmed} run(s) could not be confirmed stopped (a device may still be running them), so nothing else was changed. Try again once the device is reachable.`,
    });
  }
};

/**
 * Before `topicId` itself is archived or trashed: `all` stops and retires
 * every descendant (deepest first, task runs left to their task), `detach`
 * moves its direct sub-topics to the top level. Every affected topic is
 * checked first, under the same rules the per-topic entries apply, so a
 * refusal changes nothing.
 */
export const retireChildTopics = async (
  ctx: ChildTopicsCtx,
  params: {
    action: 'archive' | 'trash';
    mode: ChildTopicsMode;
    removeFiles?: boolean;
    topicId: string;
  },
) => {
  const { action, mode, topicId } = params;

  if (mode === 'detach') {
    const children = await ctx.topicModel.listOpenedTopics({
      excludeStatuses: RETIRED_TOPIC_STATUSES,
      openerTopicIds: [topicId],
    });
    if (children.length === 0) return;
    const ids = children.map((child) => child.id);
    await assertCanUseTopicTargets(guardCtx(ctx), ids);
    await ctx.topicModel.detachOpenedTopics(ids);
    return;
  }

  const descendants = retirableDescendants(
    topicId,
    await ctx.topicModel.listOpenedDescendants(topicId, {
      excludeStatuses: RETIRED_TOPIC_STATUSES,
    }),
  );
  if (descendants.length === 0) return;
  const ids = descendants.map((item) => item.id);

  await assertCanUseTopicTargets(guardCtx(ctx), ids);
  await assertCreatorTopicTargets(guardCtx(ctx), ids);
  if (action === 'trash') {
    for (const id of ids) {
      const topic = await ctx.topicModel.findOwnTopicById(id);
      if (topic) assertWorkspaceRowManageable(ctx as any, topic.userId, 'topic');
    }
  }
  // A run another member started cannot be stopped from here; retiring its
  // topic would leave it running under an archived conversation.
  const runByOthers = await findTopicsRunByOthers(
    { db: ctx.serverDB, workspaceId: ctx.workspaceId ?? undefined },
    { topicIds: ids, userId: ctx.userId },
  );
  if (runByOthers.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${runByOthers.length} sub-topic(s) are being run by another member, so nothing was archived or deleted. Ask them to stop, or keep the sub-topics.`,
    });
  }
  await interruptAll(ctx, ids);

  // Deepest first, so a failure part-way never leaves a child under a retired parent.
  const archive = new TopicArchiveService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
  for (const id of [...ids].reverse()) {
    if (action === 'archive') {
      await archive.updateTopic(id, { completedAt: new Date(), status: 'completed' });
    } else {
      await ctx.trashService.trashTopics([id], { removeFiles: params.removeFiles });
    }
  }
};

/** Move one sub-topic to the top level: it stops listing under, and reporting to, its parent. */
export const detachFromParent = async (ctx: ChildTopicsCtx, topicId: string) => {
  const topic = await ctx.topicModel.findById(topicId);
  if (topic?.trigger === 'task') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'A task run belongs to its task and cannot be moved to the top level; open it from the task instead.',
    });
  }
  await ctx.topicModel.detachOpenedTopics([topicId]);
};

export const childTopicsRouter = router({
  /**
   * The sub-topics under `parentTopicIds` — and, with `includeDescendants`,
   * theirs, so a grandchild can attach to the topmost visible parent — with
   * each one's state and agent (for the cross-agent avatar). Children whose
   * agent the caller may not view, and private task runs of others, are left out.
   */
  listChildTopics: topicProcedure
    .input(
      z.object({
        includeDescendants: z.boolean().optional(),
        parentTopicIds: z.array(z.string()).max(200),
      }),
    )
    .query(async ({ ctx, input }): Promise<OpenedSubTopic[]> => {
      const rows = await onlyViewableChildTopics(
        guardCtx(ctx),
        await ctx.topicModel.listOpenedTopics({
          excludeStatuses: RETIRED_TOPIC_STATUSES,
          includeDescendants: input.includeDescendants ?? true,
          openerTopicIds: input.parentTopicIds,
        }),
      );
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const agentIds = [...new Set(rows.map((row) => row.agentId).filter(Boolean))] as string[];
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
});
