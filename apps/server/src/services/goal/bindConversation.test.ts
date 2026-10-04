// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import {
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodes,
  goals,
  messages,
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import { goalRouter } from '@/server/routers/lambda/goal';
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import { GoalManagerService } from './manager';
import * as scheduler from './scheduler';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
vi.mock('@/libs/oidc-provider/access-control', () => ({ assertOIDCUserActive: async () => {} }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));

const db = await getTestDB();
const userId = 'goal-bind-test-user';
const agentId = 'goal-bind-conversation-agent';
const otherAgentId = 'goal-bind-other-agent';
const conversationTopicId = 'tpc_goal_bind_conversation';
const conversationOpId = 'op_goal_bind_conversation';
let seq = 0;

const service = () => new GoalService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId },
  ]);
  await db.insert(topics).values({ agentId, id: conversationTopicId, userId });
  await ops().recordStart({
    agentId,
    appContext: { sourceMessageId: 'msg_user_bind_request' },
    operationId: conversationOpId,
    topicId: conversationTopicId,
  });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-bind-manager-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await ops().recordStart({
      agentId: params.agentId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
      operationId,
      topicId,
    });
    return {
      agentId: params.agentId!,
      assistantMessageId: 'm',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'started',
      operationId,
      status: 'running',
      success: true,
      timestamp: new Date().toISOString(),
      topicId,
      userMessageId: 'u',
    };
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [
    goalEdges,
    goalEvents,
    goalNodes,
    goals,
    agentOperations,
    messages,
    taskTopics,
    topics,
    tasks,
    agents,
    users,
  ])
    await db.delete(table);
});

/** A goal created with plain `lh goal create`, two tasks in, one of them mid-run. */
async function standaloneGoalMidRun(goalAgentId = agentId) {
  const graph = await service().create({
    agentId: goalAgentId,
    maxRounds: 20,
    maxTotalCost: 15,
    tasks: ['Collect data', 'Write report'],
    title: 'Standalone goal',
  });
  const taskNode = graph.nodes.find((node) => node.kind === 'task')!;
  const task = await new TaskModel(db, userId).create({
    assigneeAgentId: goalAgentId,
    instruction: 'Collect data',
    status: 'running',
  });
  await db.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, taskNode.id));
  await db.update(goals).set({ status: 'running' }).where(eq(goals.id, graph.goal.id));
  return { graph: await service().graph(graph.goal.id), id: graph.goal.id, taskId: task.id };
}

const graphShape = async (id: string) => {
  const graph = await service().graph(id);
  return {
    edges: graph.edges.map(({ id: edgeId, kind, sourceNodeId, targetNodeId }) => ({
      edgeId,
      kind,
      sourceNodeId,
      targetNodeId,
    })),
    nodes: graph.nodes.map(({ id: nodeId, status, taskId, title }) => ({
      nodeId,
      status,
      taskId,
      title,
    })),
  };
};

function operationCaller(operationId: string, capabilities: string[]) {
  return goalRouter.createCaller({
    oidcAuth: {
      aud: 'urn:lobehub:hetero-operation',
      capabilities,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'urn:lobehub:internal',
      jti: 'bind-test',
      operation_id: operationId,
      payload: {},
      purpose: 'hetero-operation',
      sub: userId,
    },
  });
}

describe('GoalService.bindConversation', () => {
  it('gives a standalone goal the subject and supervision a conversation goal has, without touching its work', async () => {
    const { id, taskId } = await standaloneGoalMidRun();
    const before = await graphShape(id);

    const result = await service().bindConversation(id, conversationOpId);

    expect(result.turnToken).toBeUndefined();
    expect(result.previousSubject).toEqual({ id: null, type: 'standalone' });
    const goal = (await model().findById(id))!;
    expect(goal).toMatchObject({
      agentId,
      maxRounds: 20,
      maxTotalCost: 15,
      status: 'running',
      subjectId: conversationTopicId,
      subjectType: 'topic',
    });
    // Same policy default as `createFromConversation`.
    expect(goal.config?.manager).toEqual({});
    // No turn in flight, nothing spent: the next turn is dispatched here.
    expect(goal.config?.managerState).toMatchObject({
      consumed: true,
      topicId: conversationTopicId,
      turns: 0,
    });
    expect(await graphShape(id)).toEqual(before);
    expect((await new TaskModel(db, userId).findById(taskId))!).toMatchObject({
      assigneeAgentId: agentId,
      status: 'running',
    });
    // The conversation finds the goal the way it finds one created there.
    expect(
      (await model().list({ topicId: conversationTopicId })).goals.map((item) => item.goal.id),
    ).toEqual([id]);
    const [event] = await db
      .select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, id), eq(goalEvents.entityType, 'goal')));
    expect(event).toMatchObject({
      actorId: agentId,
      actorType: 'agent',
      eventType: 'updated',
      operationId: conversationOpId,
    });
    expect(event.reason).toContain(conversationTopicId);
  });

  it('dispatches the next planning turn into the bound conversation', async () => {
    const { id } = await standaloneGoalMidRun();
    await service().bindConversation(id, conversationOpId);

    // The work in flight settles; with the graph quiet the main Agent plans.
    await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.goalId, id));
    expect((await service().tick(id)).outcome).toBe('waiting_external');

    const call = vi.mocked(AiAgentService.prototype.execAgent).mock.calls.at(-1)![0];
    expect(call).toMatchObject({ agentId, appContext: { topicId: conversationTopicId } });
    expect((await model().findById(id))!.config!.managerState).toMatchObject({
      topicId: conversationTopicId,
      turns: 1,
    });
  });

  it('adopts the binding run as a planning turn when the goal has nothing in flight', async () => {
    const created = await service().create({ agentId, title: 'Unplanned goal' });

    const { turnToken } = await service().bindConversation(created.goal.id, conversationOpId);

    expect(turnToken).toBeTruthy();
    const goal = (await model().findById(created.goal.id))!;
    expect(goal.status).toBe('running');
    expect(goal.config?.managerState).toMatchObject({
      adopted: true,
      adoptedOperationId: conversationOpId,
      token: turnToken,
      topicId: conversationTopicId,
      turns: 1,
    });
    expect(
      await new GoalManagerService(db, userId).submit(
        created.goal.id,
        turnToken!,
        conversationOpId,
        {
          action: 'tasks',
          reason: 'Start',
          tasks: [{ description: 'Do the work', title: 'Work' }],
        },
      ),
    ).toEqual({ action: 'tasks', recorded: true });
  });

  it('refuses a goal bound to another conversation unless forced, and records the move', async () => {
    const { id } = await standaloneGoalMidRun();
    await db.insert(topics).values({ agentId, id: 'tpc_previous_conversation', userId });
    await db
      .update(goals)
      .set({
        config: {
          manager: {},
          managerState: {
            consumed: true,
            snapshot: 's',
            startedAt: new Date().toISOString(),
            token: 't',
            topicId: 'tpc_previous_conversation',
            turns: 2,
          },
        },
        subjectId: 'tpc_previous_conversation',
        subjectType: 'topic',
      })
      .where(eq(goals.id, id));

    await expect(service().bindConversation(id, conversationOpId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await model().findById(id))!.subjectId).toBe('tpc_previous_conversation');

    const result = await service().bindConversation(id, conversationOpId, { force: true });

    expect(result.previousSubject).toEqual({ id: 'tpc_previous_conversation', type: 'topic' });
    const goal = (await model().findById(id))!;
    expect(goal.subjectId).toBe(conversationTopicId);
    expect(goal.config?.managerState).toMatchObject({
      previousTopicIds: ['tpc_previous_conversation'],
      topicId: conversationTopicId,
      turns: 2,
    });
    const [event] = await db
      .select()
      .from(goalEvents)
      .where(and(eq(goalEvents.goalId, id), eq(goalEvents.entityType, 'goal')));
    expect(event.reason).toContain('moved from topic tpc_previous_conversation');
  });

  it('is a no-op re-bind to the conversation it is already bound to', async () => {
    const { id } = await standaloneGoalMidRun();
    await service().bindConversation(id, conversationOpId);

    await expect(service().bindConversation(id, conversationOpId)).resolves.toMatchObject({
      previousSubject: { id: conversationTopicId, type: 'topic' },
    });
  });

  it('refuses while a planning turn is in flight in another conversation', async () => {
    const { id } = await standaloneGoalMidRun();
    await db
      .update(goals)
      .set({
        config: {
          manager: {},
          managerState: {
            snapshot: 's',
            startedAt: new Date().toISOString(),
            token: 't',
            topicId: 'tpc_management',
            turns: 1,
          },
        },
      })
      .where(eq(goals.id, id));

    await expect(service().bindConversation(id, conversationOpId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await model().findById(id))!.subjectType).toBe('standalone');
  });

  it.each(['achieved', 'failed', 'canceled'] as const)('refuses a %s goal', async (status) => {
    const { id } = await standaloneGoalMidRun();
    await db.update(goals).set({ status }).where(eq(goals.id, id));

    await expect(service().bindConversation(id, conversationOpId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await model().findById(id))!).toMatchObject({ status, subjectType: 'standalone' });
  });

  it('refuses a run whose conversation belongs to another agent', async () => {
    const { id } = await standaloneGoalMidRun();
    await db.insert(topics).values({ agentId: otherAgentId, id: 'tpc_other_agent', userId });
    await ops().recordStart({
      agentId,
      operationId: 'op_mismatched_topic',
      topicId: 'tpc_other_agent',
    });

    await expect(service().bindConversation(id, 'op_mismatched_topic')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("refuses a local run naming another agent's or another user's conversation", async () => {
    const { id } = await standaloneGoalMidRun();
    await db.insert(topics).values({ agentId: otherAgentId, id: 'tpc_other_agent', userId });
    await db.insert(users).values({ id: 'goal-bind-stranger' });
    await db.insert(agents).values({ id: 'stranger-agent', userId: 'goal-bind-stranger' });
    await db
      .insert(topics)
      .values({ agentId: 'stranger-agent', id: 'tpc_stranger', userId: 'goal-bind-stranger' });

    for (const localRun of [
      { agentId, topicId: 'tpc_other_agent' },
      { agentId: 'stranger-agent', topicId: 'tpc_stranger' },
    ])
      await expect(
        service().bindConversation(id, 'op_client_only', { localRun }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await model().findById(id))!.subjectType).toBe('standalone');
  });

  it('binds a local desktop run that has no server operation row', async () => {
    const { id } = await standaloneGoalMidRun();

    await service().bindConversation(id, 'op_client_only', {
      localRun: { agentId, topicId: conversationTopicId },
    });

    expect((await model().findById(id))!).toMatchObject({
      subjectId: conversationTopicId,
      subjectType: 'topic',
    });
  });

  it('refuses a conversation run that has already ended', async () => {
    const { id } = await standaloneGoalMidRun();
    await ops().recordCompletion(conversationOpId, { status: 'done' });

    await expect(service().bindConversation(id, conversationOpId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('hands supervision to the conversation agent and moves unfinished tasks like setAgent', async () => {
    const { id, taskId } = await standaloneGoalMidRun(otherAgentId);

    const result = await service().bindConversation(id, conversationOpId);

    expect(result.reassignedTaskIds).toEqual([taskId]);
    expect((await model().findById(id))!.agentId).toBe(agentId);
    expect((await new TaskModel(db, userId).findById(taskId))!.assigneeAgentId).toBe(agentId);
  });

  it('keeps unfinished tasks with their agent when goalOnly is set', async () => {
    const { id, taskId } = await standaloneGoalMidRun(otherAgentId);

    const result = await service().bindConversation(id, conversationOpId, { goalOnly: true });

    expect(result.reassignedTaskIds).toEqual([]);
    expect((await model().findById(id))!.agentId).toBe(agentId);
    expect((await new TaskModel(db, userId).findById(taskId))!.assigneeAgentId).toBe(otherAgentId);
  });
});

describe('goal.bindOperationConversation', () => {
  it('binds only with the goal capability an operation token gets from /goal', async () => {
    const { id } = await standaloneGoalMidRun();

    await expect(
      operationCaller(conversationOpId, ['hetero:ingest']).bindOperationConversation({
        id,
        operationId: conversationOpId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await model().findById(id))!.subjectType).toBe('standalone');

    const result = await operationCaller(conversationOpId, [
      'hetero:ingest',
      'goal:manage',
    ]).bindOperationConversation({ id, operationId: conversationOpId });

    expect(result?.data.goal).toMatchObject({
      subjectId: conversationTopicId,
      subjectType: 'topic',
    });
    expect(scheduler.scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: id, userId }),
    );
  });

  it("cannot reach another user's goal", async () => {
    await db.insert(users).values({ id: 'goal-bind-stranger' });
    const foreign = await new GoalService(db, 'goal-bind-stranger').create({ title: 'Not yours' });

    await expect(
      operationCaller(conversationOpId, ['hetero:ingest', 'goal:manage']).bindOperationConversation(
        { id: foreign.goal.id, operationId: conversationOpId },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
