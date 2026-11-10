import { createHash } from 'node:crypto';

import type { GoalGraphSnapshot, GoalManagerState } from '@lobechat/types';
import pMap from 'p-map';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { MANAGER_SOURCE_MESSAGE_PREFIX, type ManagerContext } from './turnState';

/** Management spend of a Goal: the planning turns it paid for, across every conversation it planned in. */
export const managerUsage = async (
  ctx: ManagerContext,
  goalId: string,
  state?: GoalManagerState,
) => {
  // The planning topic can be the user's own conversation (`/goal`), so only
  // manager turns count as management spend: the dispatched ones by their
  // server-minted source message, the adopted one by its operation id. The
  // rest of that conversation is the user's chat, not the goal's budget.
  if (!state) return { totalCost: 0, totalTokens: 0 };
  const model = new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId);
  // Later receipts replace `adopted` / `operationId`, so the adopted run is
  // read from the id every receipt carries forward.
  const adoptedId = state.adoptedOperationId ?? (state.adopted ? state.operationId : undefined);
  // A handoff moves later turns to the new agent's topic; the turns already
  // spent in the conversations it left behind still belong to the Goal, so
  // they are summed too instead of dropping out of its budget.
  const goalTokenPrefix = `${MANAGER_SOURCE_MESSAGE_PREFIX}${goalId}_`;
  // One read per conversation the Goal planned in. The list grows with every
  // handoff, so the fan-out is capped rather than left to the history length.
  const reads = await pMap(
    [state.topicId, ...(state.previousTopicIds ?? [])],
    async (topicId, index) => ({
      current: index === 0,
      operations: await model.listByTopic(topicId, 100),
    }),
    { concurrency: 5 },
  );
  const operations = reads.flatMap(({ current, operations: topicOperations }) =>
    topicOperations.filter((op) => {
      if (op.id === adoptedId) return true;
      const source = op.appContext?.sourceMessageId;
      // The Goal's own conversation keeps the historical prefix match: a turn
      // dispatched before the token carried the Goal id has no marker to match.
      if (current) return source?.startsWith(MANAGER_SOURCE_MESSAGE_PREFIX);
      // A conversation the Goal moved out of is matched on the Goal's own
      // marker only. It can be shared with another Goal created in the same
      // conversation, whose turns are not this Goal's spend.
      return source?.startsWith(goalTokenPrefix);
    }),
  );
  // The adopted run lives on the conversation that created the Goal; keep it
  // counted even when it is not among the topics read above.
  if (adoptedId && !operations.some((op) => op.id === adoptedId)) {
    const adoptedRun = await model.findById(adoptedId);
    if (adoptedRun) operations.push(adoptedRun);
  }
  return {
    totalCost: operations.reduce((sum, op) => sum + (Number(op.totalCost) || 0), 0),
    totalTokens: operations.reduce((sum, op) => sum + (op.totalTokens ?? 0), 0),
  };
};

/** Task review comments a planning turn reads, and the hash that fences its plan against newer ones. */
export const reviewFeedback = async (
  ctx: ManagerContext,
  graph: GoalGraphSnapshot,
  db = ctx.db,
) => {
  const tasks = new TaskModel(db, ctx.userId, ctx.workspaceId);
  const visible = await tasks.findByIds(graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])));
  // The node title names the task the way the goal page does, for the person
  // reading the card; kept out of the hash, so a rename does not invalidate a
  // turn's feedback snapshot.
  const titles = new Map(graph.nodes.flatMap((n) => (n.taskId ? [[n.taskId, n.title]] : [])));
  const comments = (
    await pMap(
      visible,
      async (task) =>
        (await tasks.getComments(task.id)).map((comment) => ({
          taskId: task.id,
          id: comment.id,
          content: comment.content,
          authorUserId: comment.authorUserId,
          authorAgentId: comment.authorAgentId,
          updatedAt: comment.updatedAt,
        })),
      { concurrency: 5 },
    )
  )
    .flat()
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    hash: createHash('sha256').update(JSON.stringify(comments)).digest('hex'),
    notes: [...comments]
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map((c) => ({
        author: c.authorAgentId ? `agent ${c.authorAgentId}` : 'user',
        content: c.content,
        taskId: c.taskId,
        taskTitle: titles.get(c.taskId) ?? undefined,
        updatedAt: c.updatedAt,
      })),
  };
};

/** Whether a budget bound is reached, with the numbers behind it for `lh goal state`. */
export const budgetFacts = async (ctx: ManagerContext, graph: GoalGraphSnapshot, db = ctx.db) => {
  const spend = await new TaskTopicModel(db, ctx.userId, ctx.workspaceId).sumRunCostByTaskIds(
    graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])),
  );
  const management = await managerUsage(
    { ...ctx, db },
    graph.goal.id,
    graph.goal.config?.managerState,
  );
  const goal = graph.goal;
  const totalCost = spend.totalCost + management.totalCost;
  const deadline = goal.config?.schedule?.deadline ?? null;
  return {
    blocked:
      (goal.maxRounds !== null && spend.runs >= goal.maxRounds) ||
      (goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost)) ||
      (!!deadline && Date.now() >= Date.parse(deadline)),
    deadline,
    maxRounds: goal.maxRounds,
    maxTotalCost: goal.maxTotalCost,
    runs: spend.runs,
    totalCost,
  };
};

export const budgetBlocked = async (ctx: ManagerContext, graph: GoalGraphSnapshot, db = ctx.db) =>
  (await budgetFacts(ctx, graph, db)).blocked;
