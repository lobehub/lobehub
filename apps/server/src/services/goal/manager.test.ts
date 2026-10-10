// @vitest-environment node
import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_MANAGER_QUESTION_TITLE,
} from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MessageModel } from '@/database/models/message';
import { TaskModel } from '@/database/models/task';
import {
  acceptances,
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
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
import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';

import { deviceGateway } from '../deviceGateway';
import { GoalService } from './index';
import { decideFailedTurn, GoalManagerService, MAX_FAILED_MANAGER_TURNS } from './manager';
import * as scheduler from './scheduler';
import { GoalWaitService } from './wait';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
vi.mock('@/libs/oidc-provider/access-control', () => ({ assertOIDCUserActive: async () => {} }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));

const db = await getTestDB();
const userId = 'cli-manager-test-user';
const agentId = 'cli-manager-test-agent';
let seq = 0;
const service = () => new GoalService(db, userId);
const manager = () => new GoalManagerService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);
const taskPlan = {
  action: 'tasks' as const,
  reason: 'Audit before comparing',
  tasks: [{ title: 'Audit', description: 'Count actual evidence and register a report' }],
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-manager-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await ops().recordStart({
      operationId,
      agentId: params.agentId,
      topicId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
    });
    return {
      operationId,
      topicId,
      agentId: params.agentId!,
      assistantMessageId: 'm',
      userMessageId: 'u',
      autoStarted: true,
      success: true,
      status: 'running',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      message: 'started',
    };
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [
    goalNodeDecisions,
    goalEdges,
    goalEvents,
    goalNodes,
    goals,
    acceptances,
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

async function start(maxTurns = 4) {
  const graph = await service().create({
    title: 'Managed research',
    createdByAgentId: agentId,
    config: { manager: { maxTurns } },
  });
  // A manager-mode Goal predates the mandatory-supervision invariant, and the
  // server now writes supervision onto every Goal it creates. Clear it so this
  // file keeps covering the manager's own recovery path: with supervision on, an
  // eligible transport failure is handled by the supervisor instead (see the
  // `failure_decision` ordering in GoalService).
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns } } })
    .where(eq(goals.id, graph.goal.id));
  expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
  const state = (await model().findById(graph.goal.id))!.config!.managerState!;
  const op = await ops().findByTopicSourceMessage(state.topicId, `msg_goal_manager_${state.token}`);
  return { id: graph.goal.id, state, op: op! };
}

function operationCaller(operationId: string, overrides: Record<string, unknown> = {}) {
  return goalRouter.createCaller({
    oidcAuth: {
      payload: {},
      aud: 'urn:lobehub:hetero-operation',
      capabilities: ['hetero:ingest'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'urn:lobehub:internal',
      jti: 'plan-test',
      operation_id: operationId,
      purpose: 'hetero-operation',
      sub: userId,
      ...overrides,
    },
  });
}

describe('CLI main Agent planning', () => {
  it('accepts a plan through the operation-authenticated router and persists its receipt', async () => {
    const { id, state, op } = await start();
    const caller = operationCaller(op.id);
    await expect(
      caller.submitOperationPlan({ id, operationId: op.id, token: state.token, plan: taskPlan }),
    ).resolves.toMatchObject({ success: true });
    expect((await model().findById(id))!.config!.managerState!.submitted).toEqual({
      action: taskPlan.action,
      reason: taskPlan.reason,
    });
    expect((await service().graph(id)).nodes.some((node) => node.title === 'Audit')).toBe(true);
    await expect(caller.delete({ id })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each([
    { operation_id: 'other' },
    { capabilities: ['hetero:finish'] },
    { sub: 'other-user' },
    { workspace_id: 'other-workspace' },
  ])('rejects a plan outside the operation token scope: %j', async (claims) => {
    const { id, state, op } = await start();
    await expect(
      operationCaller(op.id, claims).submitOperationPlan({
        id,
        operationId: op.id,
        token: state.token,
        plan: taskPlan,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await model().findById(id))!.config!.managerState!.submitted).toBeUndefined();
  });

  it('rejects unrelated Goal turns and terminal operation tokens', async () => {
    const { id, state, op } = await start();
    const other = await start();
    const caller = operationCaller(op.id);
    await expect(
      caller.submitOperationPlan({
        id: other.id,
        operationId: op.id,
        token: other.state.token,
        plan: taskPlan,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await ops().recordCompletion(op.id, { status: 'done', completionReason: 'done' });
    await expect(
      caller.submitOperationPlan({ id, operationId: op.id, token: state.token, plan: taskPlan }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects legacy operation tokens without a bound identity', async () => {
    const { id, state, op } = await start();
    const caller = goalRouter.createCaller({
      oidcAuth: { payload: {}, sub: userId, purpose: 'hetero-operation' },
    });
    await expect(
      caller.submitOperationPlan({ id, operationId: op.id, token: state.token, plan: taskPlan }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('dispatches planning turns to the goal agent, not the task agent', async () => {
    await db.insert(agents).values({ id: 'task-worker', userId });
    const graph = await service().create({
      agentId,
      title: 'Supervised goal',
      config: { manager: {}, taskAgentId: 'task-worker' },
    });
    expect(graph.goal.agentId).toBe(agentId);
    expect(graph.goal.config?.taskAgentId).toBe('task-worker');
    expect(graph.goal.config?.manager).not.toHaveProperty('agentId');
    expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
    const state = (await model().findById(graph.goal.id))!.config!.managerState!;
    const op = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );
    expect(op?.agentId).toBe(agentId);
    expect(
      (await service().graph(graph.goal.id)).nodes.filter((n) => n.kind === 'task'),
    ).toHaveLength(0);
  });

  it('uses the selected Agent for a user-created goal without attributing authorship to it', async () => {
    const graph = await service().create({
      agentId,
      title: 'Selected agent',
      config: { manager: {} },
    });
    expect(graph.goal.agentId).toBe(agentId);
    expect(graph.events.every((event) => event.actorType === 'user')).toBe(true);
  });

  it.each([undefined, { recovery: { maxAttemptsPerTask: 3 } }])(
    'keeps coordinator planning for an ordinary selected agent: %j',
    async (config) => {
      const graph = await service().create({ agentId, title: 'Chat agent goal', config });
      expect(graph.goal.config?.manager).toBeUndefined();
      expect(graph.goal.config?.managerState).toBeUndefined();
    },
  );

  it('ignores a legacy manager identity: the goal agent plans', async () => {
    const config = { manager: { agentId: 'unrelated-agent', maxTurns: 5 } };
    const graph = await service().create({
      createdByAgentId: agentId,
      config,
      title: 'Bound creator',
    });
    expect(graph.goal.agentId).toBe(agentId);
    expect(graph.goal.config?.manager).toEqual({ maxTurns: 5 });
    await db.insert(agents).values({ id: 'next-supervisor', userId });
    await service().setAgent(graph.goal.id, 'next-supervisor');
    const moved = await model().findById(graph.goal.id);
    expect(moved?.agentId).toBe('next-supervisor');
    expect(moved?.config?.manager).toEqual({ maxTurns: 5 });
  });

  it('requires an accessible creator when planning options are supplied', async () => {
    await expect(
      service().create({ title: 'Missing creator', config: { manager: {} } }),
    ).rejects.toThrow('requires the goal agent');
    await expect(
      service().create({ title: 'Unknown creator', createdByAgentId: 'unrelated-agent' }),
    ).rejects.toThrow();
  });

  it('commits once and does not dispatch graph work until the main turn exits', async () => {
    const { id, state, op } = await start();
    expect(await manager().submit(id, state.token, op.id, taskPlan)).toEqual({
      recorded: true,
      action: 'tasks',
    });
    expect(
      await manager().submit(id, state.token, op.id, {
        action: 'verify',
        reason: 'duplicate replacement',
      }),
    ).toMatchObject({ duplicate: true, plan: { action: 'tasks' } });
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(1);
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');
    const created = await service().tick(id);
    expect(created.taskId).toBeTruthy();
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  describe('/goal from a conversation run', () => {
    const conversationTopicId = 'tpc_goal_conversation';
    const conversationOpId = 'op_goal_conversation';

    const startConversationRun = async () => {
      await db.insert(topics).values({ agentId, id: conversationTopicId, userId });
      await ops().recordStart({
        agentId,
        appContext: { sourceMessageId: 'msg_user_goal_request' },
        operationId: conversationOpId,
        topicId: conversationTopicId,
      });
    };

    it('supervises from the conversation and plans in the same run', async () => {
      await startConversationRun();

      const { graph, turnToken } = await service().createFromConversation(conversationOpId, {
        criteria: [{ title: 'Report delivered' }],
        title: 'Ship the report',
      });

      expect(graph.goal).toMatchObject({
        agentId,
        subjectId: conversationTopicId,
        subjectType: 'topic',
      });
      const state = (await model().findById(graph.goal.id))!.config!.managerState!;
      expect(state).toMatchObject({
        adopted: true,
        operationId: conversationOpId,
        token: turnToken,
        topicId: conversationTopicId,
        turns: 1,
      });

      // The creating run plans with the returned token, no dispatched turn needed.
      expect(await manager().submit(graph.goal.id, turnToken, conversationOpId, taskPlan)).toEqual({
        action: 'tasks',
        recorded: true,
      });
      expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
      await ops().recordCompletion(conversationOpId, { status: 'done' });
      expect((await service().tick(graph.goal.id)).outcome).toBe('advanced');
      expect((await service().tick(graph.goal.id)).taskId).toBeTruthy();
      expect(vi.mocked(AiAgentService.prototype.execAgent)).not.toHaveBeenCalled();
      expect(
        (await model().list({ topicId: conversationTopicId })).goals.map((item) => item.goal.id),
      ).toEqual([graph.goal.id]);
    });

    it('counts only planning turns, not the rest of the conversation, as management spend', async () => {
      await startConversationRun();
      await ops().recordStart({
        agentId,
        appContext: { sourceMessageId: 'msg_user_unrelated_chat' },
        operationId: 'op_goal_conversation_chat',
        topicId: conversationTopicId,
      });
      await db
        .update(agentOperations)
        .set({ totalCost: 2 })
        .where(eq(agentOperations.id, conversationOpId));
      await db
        .update(agentOperations)
        .set({ totalCost: 5 })
        .where(eq(agentOperations.id, 'op_goal_conversation_chat'));

      const { graph } = await service().createFromConversation(conversationOpId, {
        title: 'Budgeted goal',
      });
      const state = (await model().findById(graph.goal.id))!.config!.managerState!;

      expect((await manager().usage(graph.goal.id, state)).totalCost).toBe(2);
    });

    it('keeps the adopted run in management spend after a later turn replaces the receipt', async () => {
      await startConversationRun();
      await db
        .update(agentOperations)
        .set({ totalCost: 2 })
        .where(eq(agentOperations.id, conversationOpId));
      const { graph } = await service().createFromConversation(conversationOpId, {
        title: 'Two-turn goal',
      });
      const adopted = (await model().findById(graph.goal.id))!.config!.managerState!;
      expect(adopted.adoptedOperationId).toBe(conversationOpId);

      // What `startTurn` writes for turn two: a fresh receipt with no `adopted`
      // flag and no operation yet. The first run's spend used to vanish here,
      // so both the displayed usage and the budget check under-counted.
      const laterTurn = {
        adoptedOperationId: adopted.adoptedOperationId,
        snapshot: adopted.snapshot,
        startedAt: new Date().toISOString(),
        token: 'turn-two',
        topicId: conversationTopicId,
        turns: 2,
      };

      expect((await manager().usage(graph.goal.id, laterTurn)).totalCost).toBe(2);
      // After a handoff the later turn lives on another topic; the run still counts.
      expect(
        (await manager().usage(graph.goal.id, { ...laterTurn, topicId: 'tpc_other_supervisor' }))
          .totalCost,
      ).toBe(2);
    });

    it('plans a local desktop run that has no server operation row', async () => {
      await db.insert(topics).values({ agentId, id: conversationTopicId, userId });
      const localRun = { agentId, topicId: conversationTopicId };

      const { graph, turnToken } = await service().createFromConversation(
        'op_client_only_local_run',
        { title: 'Local goal' },
        localRun,
      );
      expect(graph.goal).toMatchObject({ agentId, subjectId: conversationTopicId });

      expect(
        await manager().submit(graph.goal.id, turnToken, 'op_client_only_local_run', taskPlan),
      ).toEqual({ action: 'tasks', recorded: true });
      // No run to watch exit: the submitted plan settles the turn.
      expect((await service().tick(graph.goal.id)).outcome).toBe('advanced');
      expect((await service().tick(graph.goal.id)).taskId).toBeTruthy();
      expect(vi.mocked(AiAgentService.prototype.execAgent)).not.toHaveBeenCalled();

      await expect(
        manager().submit(graph.goal.id, turnToken, 'op_some_other_run', taskPlan),
      ).rejects.toThrow();
    });

    it("refuses a local run whose conversation is not the agent's", async () => {
      await db.insert(agents).values({ id: 'other-local-agent', userId });
      await db.insert(topics).values({
        agentId: 'other-local-agent',
        id: conversationTopicId,
        userId,
      });

      await expect(
        service().createFromConversation(
          'op_client_only_local_run',
          { title: 'Borrowed conversation' },
          { agentId, topicId: conversationTopicId },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses a conversation run that has already ended', async () => {
      await startConversationRun();
      await ops().recordCompletion(conversationOpId, { status: 'done' });

      await expect(
        service().createFromConversation(conversationOpId, { title: 'Too late' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('lets an operation token create the goal only with the goal capability', async () => {
      await startConversationRun();

      await expect(
        operationCaller(conversationOpId).createConversationGoal({
          operationId: conversationOpId,
          title: 'No capability',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const result = await operationCaller(conversationOpId, {
        capabilities: ['hetero:ingest', 'goal:manage'],
      }).createConversationGoal({ operationId: conversationOpId, title: 'From device' });

      expect(result.turnToken).toBeTruthy();
      expect(result.data?.goal).toMatchObject({ agentId, subjectType: 'topic' });
    });
  });

  /**
   * Regression: every planned task used to hang only off the problem node, so a
   * multi-round Goal rendered as one flat row with no visible progression.
   */
  it('links planned tasks to earlier rounds and earlier tasks through depends_on', async () => {
    const graph = await service().create({
      title: 'Second round',
      createdByAgentId: agentId,
      config: { manager: { maxTurns: 4 } },
    });
    const earlier = await new GoalGraphModel(db, userId).createNode(graph.goal.id, {
      kind: 'task',
      status: 'resolved',
      title: 'R1 · Facts',
    });
    expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
    const state = (await model().findById(graph.goal.id))!.config!.managerState!;
    const op = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );

    await manager().submit(graph.goal.id, state.token, op!.id, {
      action: 'tasks',
      reason: 'Analyse on top of the facts',
      tasks: [
        { title: 'R2 · Options', description: 'Compare options', dependsOn: [earlier!.id] },
        { title: 'R3 · Report', description: 'Write the report', dependsOn: [0] },
      ],
    });

    const current = await service().graph(graph.goal.id);
    const byTitle = (title: string) => current.nodes.find((n) => n.title === title)!;
    const dependsOn = current.edges
      .filter((edge) => edge.kind === 'depends_on')
      .map((edge) => [edge.sourceNodeId, edge.targetNodeId]);
    expect(dependsOn).toEqual(
      expect.arrayContaining([
        [byTitle('R2 · Options').id, earlier!.id],
        [byTitle('R3 · Report').id, byTitle('R2 · Options').id],
      ]),
    );
    expect(dependsOn).toHaveLength(2);
  });

  it.each([
    { label: 'a forward index', dependsOn: [1] },
    { label: 'an unknown node', dependsOn: ['node-that-does-not-exist'] },
  ])(
    'rejects a plan whose dependsOn names $label without writing any task',
    async ({ dependsOn }) => {
      const { id, state, op } = await start();
      await expect(
        manager().submit(id, state.token, op.id, {
          action: 'tasks',
          reason: 'Plan with a bad reference',
          tasks: [
            { title: 'First', description: 'First task', dependsOn },
            { title: 'Second', description: 'Second task' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
      expect((await model().findById(id))!.config!.managerState!.submitted).toBeUndefined();
    },
  );

  it('does not dispatch the previous supervisor when a handoff lands before the claim', async () => {
    const { id, op } = await start();
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');
    // The coordinator read the graph, then the goal was handed over before it
    // locked the row to claim the next turn.
    const staleGraph = await service().graph(id);
    await db.insert(agents).values({ id: 'handoff-supervisor', userId });
    await service().setAgent(id, 'handoff-supervisor');
    const turnsBefore = (await model().findById(id))!.config!.managerState!.turns;

    await manager().advance(staleGraph, { mayStartTurn: true });

    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    expect((await model().findById(id))!.config!.managerState!.turns).toBe(turnsBefore);
  });

  it('opens the next planning turn in the new supervisor history after a handoff', async () => {
    const { id, state, op } = await start();
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');

    await db.insert(agents).values({ id: 'next-supervisor', userId });
    await service().setAgent(id, 'next-supervisor');
    expect((await service().tick(id)).outcome).toBe('waiting_external');

    const next = (await model().findById(id))!.config!.managerState!;
    expect(next.topicId).not.toBe(state.topicId);
    const [topic] = await db.select().from(topics).where(eq(topics.id, next.topicId));
    expect(topic?.agentId).toBe('next-supervisor');
    // Both management topics stay out of the agent's chat sidebar.
    const [first] = await db.select().from(topics).where(eq(topics.id, state.topicId));
    expect(first?.trigger).toBe('goal_supervision');
    expect(topic?.trigger).toBe('goal_supervision');
    const nextOp = await ops().findByTopicSourceMessage(
      next.topicId,
      `msg_goal_manager_${next.token}`,
    );
    expect(nextOp?.agentId).toBe('next-supervisor');
    // The earlier supervisor's operation no longer speaks for the goal.
    await expect(manager().submit(id, next.token, op.id, taskPlan)).rejects.toThrow('Unrelated');
  });

  it('moves the management conversation to the new agent at the handoff', async () => {
    const { id, state, op } = await start();
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');

    await db.insert(agents).values({ id: 'handoff-target', userId });
    const { goal } = await service().setAgent(id, 'handoff-target');

    // The row handed back to the caller already points at the new agent's topic,
    // so the supervision panel and its "open conversation" link follow the
    // handoff instead of staying on the previous agent until the next claim.
    const moved = (await model().findById(id))!.config!.managerState!;
    expect(moved.topicId).not.toBe(state.topicId);
    expect(goal.config?.managerState?.topicId).toBe(moved.topicId);
    const [topic] = await db.select().from(topics).where(eq(topics.id, moved.topicId));
    expect(topic?.agentId).toBe('handoff-target');
    expect(topic?.trigger).toBe('goal_supervision');
    // The conversation it left behind is retained rather than orphaned.
    expect(moved.previousTopicIds).toEqual([state.topicId]);
  });

  it('keeps counting the previous conversations in management spend', async () => {
    const { id, state, op } = await start();
    await db.update(agentOperations).set({ totalCost: 3 }).where(eq(agentOperations.id, op.id));
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');

    await db.insert(agents).values({ id: 'spend-target', userId });
    await service().setAgent(id, 'spend-target');
    expect((await service().tick(id)).outcome).toBe('waiting_external');

    const next = (await model().findById(id))!.config!.managerState!;
    // The turn now runs in the new agent's topic; the spend already booked in
    // the conversation it left still belongs to the goal's management budget.
    expect(next.topicId).not.toBe(state.topicId);
    expect((await manager().usage(id, next)).totalCost).toBe(3);
  });

  it('leaves a live turn on the previous agent topic instead of migrating mid-turn', async () => {
    const { id, state } = await start();
    await db.insert(agents).values({ id: 'mid-turn-target', userId });

    // The first turn is dispatched but not settled: `settleInFlight` finds its
    // run through `state.topicId`, so re-pointing now would strand it.
    await service().setAgent(id, 'mid-turn-target');

    const untouched = (await model().findById(id))!.config!.managerState!;
    expect(untouched.topicId).toBe(state.topicId);
    expect(untouched.previousTopicIds).toBeUndefined();
    expect(
      await db.select().from(topics).where(eq(topics.agentId, 'mid-turn-target')),
    ).toHaveLength(0);
  });

  it('migrates on the next claim after a mid-turn handoff and retains the old conversation', async () => {
    const { id, state, op } = await start();
    await db.insert(agents).values({ id: 'late-target', userId });
    await service().setAgent(id, 'late-target');

    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');
    expect((await service().tick(id)).outcome).toBe('waiting_external');

    const next = (await model().findById(id))!.config!.managerState!;
    const [topic] = await db.select().from(topics).where(eq(topics.id, next.topicId));
    expect(topic?.agentId).toBe('late-target');
    // The conversation the handoff moved out of keeps counting.
    expect(next.previousTopicIds).toEqual([state.topicId]);
  });

  it('does not charge another Goal’s turns in a shared conversation to this one', async () => {
    const a = await start();
    const shared = a.state.topicId;
    // A second Goal is created from the same conversation and plans there too —
    // the shared conversation a retained topic can turn out to be.
    const sharedRunId = 'op-shared-conversation-run';
    await ops().recordStart({
      agentId,
      appContext: { sourceMessageId: 'msg_user_second_goal' },
      operationId: sharedRunId,
      topicId: shared,
    });
    const { graph: b } = await service().createFromConversation(sharedRunId, {
      title: 'Second goal',
    });
    await ops().recordCompletion(sharedRunId, { status: 'done' });
    expect((await service().tick(b.goal.id)).outcome).toBe('advanced');
    expect((await service().tick(b.goal.id)).outcome).toBe('waiting_external');
    const bState = (await model().findById(b.goal.id))!.config!.managerState!;
    const bTurn = await ops().findByTopicSourceMessage(shared, `msg_goal_manager_${bState.token}`);
    expect(bTurn).toBeTruthy();
    await db.update(agentOperations).set({ totalCost: 9 }).where(eq(agentOperations.id, bTurn!.id));

    // A hands over, retaining the shared conversation as one it moved out of.
    await ops().recordCompletion(a.op.id, { status: 'done' });
    expect((await service().tick(a.id)).outcome).toBe('advanced');
    await db.insert(agents).values({ id: 'shared-target', userId });
    await service().setAgent(a.id, 'shared-target');
    const retained = (await model().findById(a.id))!.config!.managerState!;
    expect(retained.previousTopicIds).toEqual([shared]);

    await db.update(agentOperations).set({ totalCost: 1 }).where(eq(agentOperations.id, a.op.id));
    // Only A's own turn counts; the other Goal's run in the same conversation does not.
    expect((await manager().usage(a.id, retained)).totalCost).toBe(1);
  });

  it('declines a handoff migration whose target is no longer the goal agent', async () => {
    const { id, op } = await start();
    await ops().recordCompletion(op.id, { status: 'done' });
    expect((await service().tick(id)).outcome).toBe('advanced');
    await db.insert(agents).values([
      { id: 'first-target', userId },
      { id: 'second-target', userId },
    ]);

    // Two overlapping handoffs: this call's migration runs after the later one
    // has already re-assigned the Goal, so its target is stale.
    await service().setAgent(id, 'second-target');
    expect(await manager().moveConversationTo(id, 'first-target')).toBeUndefined();

    const state = (await model().findById(id))!.config!.managerState!;
    const [topic] = await db.select().from(topics).where(eq(topics.id, state.topicId));
    expect(topic?.agentId).toBe('second-target');
  });

  it('rejects wrong owner, operation, pause and changed graph without adding tasks', async () => {
    const { id, state, op } = await start();
    await expect(
      new GoalManagerService(db, 'other-user').submit(id, state.token, op.id, taskPlan),
    ).rejects.toThrow('does not own');
    await expect(manager().submit(id, state.token, 'other-op', taskPlan)).rejects.toThrow(
      'Unrelated',
    );
    await service().pause(id);
    await expect(manager().submit(id, state.token, op.id, taskPlan)).rejects.toThrow('stopped');
    await model().updateStatus(id, 'running');
    await new GoalGraphModel(db, userId).createNode(id, {
      title: 'Changed input',
      kind: 'finding',
    });
    await expect(manager().submit(id, state.token, op.id, taskPlan)).rejects.toThrow('Stale');
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
  });

  it('names on the read path the refusal submit folds into one message', async () => {
    const { id, state, op } = await start();

    // A live, unchanged turn: both paths agree a plan would apply.
    expect((await manager().admission(id)).admission).toMatchObject({ code: 'ok', ok: true });

    // The same changed graph `submit` refuses — but admission says WHICH
    // precondition failed, where the shared message says only "Stale planning
    // input". This is the answer `lh goal state` renders.
    await new GoalGraphModel(db, userId).createNode(id, {
      title: 'Changed input',
      kind: 'finding',
    });
    expect((await manager().admission(id)).admission).toMatchObject({
      code: 'stale_input',
      ok: false,
    });
    await expect(manager().submit(id, state.token, op.id, taskPlan)).rejects.toThrow('Stale');

    // A pause is its own code, not the same "the graph moved" answer.
    await service().pause(id);
    expect((await manager().admission(id)).admission).toMatchObject({
      code: 'inactive',
      ok: false,
    });
  });

  it('pages the goal audit trail newest first and refuses another owner', async () => {
    const { id } = await start();
    const graph = new GoalGraphModel(db, userId);
    // A second event, so paging has something to page over.
    await graph.createNode(id, { title: 'Extra finding', kind: 'finding' });
    const all = await graph.listEvents(id, { limit: 50 });

    expect(all!.length).toBeGreaterThan(1);
    expect(all![0]!.createdAt.getTime()).toBeGreaterThanOrEqual(all!.at(-1)!.createdAt.getTime());

    // Paging must not repeat or skip: offset 1 starts on the second-newest row.
    const page = await graph.listEvents(id, { limit: 1, offset: 1 });
    expect(page![0]!.id).toBe(all![1]!.id);

    // A missing goal and someone else's goal are both invisible.
    expect(await graph.listEvents('goal-missing', { limit: 5 })).toBeUndefined();
    expect(await new GoalGraphModel(db, 'other-user').listEvents(id, { limit: 5 })).toBeUndefined();
  });

  it('adopts a dispatch with a lost response rather than launching another Agent', async () => {
    const original = vi.mocked(AiAgentService.prototype.execAgent).getMockImplementation()!;
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementation(async (params) => {
      await original(params);
      throw new Error('Response lost');
    });
    const { id } = await start();
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('replans after a confirmed failed main turn but stops at its turn budget', async () => {
    const { id, op } = await start(1);
    await ops().recordCompletion(op.id, {
      status: 'error',
      completionReason: 'error',
      error: { message: 'transport error' },
    });
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    expect((await service().tick(id)).outcome).toBe('no_progress');
    expect((await model().findById(id))!.status).toBe('paused');
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('records a turn-budget pause as the system, not the owner', async () => {
    const { id, op } = await start(1);
    await ops().recordCompletion(op.id, {
      status: 'error',
      completionReason: 'error',
      error: { message: 'transport error' },
    });
    await service().tick(id);
    await service().tick(id);

    const pause = (await service().graph(id)).events.find(
      (event) =>
        event.entityType === 'goal' && event.reason === 'Goal or main Agent turn budget exhausted',
    );
    expect(pause).toMatchObject({ actorId: GOAL_COORDINATOR_ACTOR_ID, actorType: 'system' });
  });

  it('rejects a delayed claim after another turn has consumed the remaining budget', async () => {
    const { id, op } = await start(2);
    await ops().recordCompletion(op.id, { status: 'error' });
    await service().tick(id);
    const stale = await service().graph(id);
    // Past the backoff the failed turn set, so the next turn may start.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60_000);
    await service().tick(id);
    const second = (await model().findById(id))!.config!.managerState!;
    await ops().recordCompletion(second.operationId!, { status: 'error' });
    await service().tick(id);
    await manager().advance(stale);
    expect((await model().findById(id))!.config!.managerState!.turns).toBe(2);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
    await service().tick(id);
    expect((await model().findById(id))!.status).toBe('paused');
  });

  describe('a turn that fails without a plan', () => {
    const quotaError = (resetsAt: number) => ({
      message: "You've hit your session limit",
      category: 'quota',
      body: {
        code: 'rate_limit',
        rateLimitInfo: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' },
      },
    });

    it('waits for a quota reset without charging the refused turn', async () => {
      const { id, op } = await start(3);
      const now = Date.now();
      const resetsAt = Math.floor(now / 1000) + 600;
      await ops().recordCompletion(op.id, { status: 'error', error: quotaError(resetsAt) });

      expect((await service().tick(id)).outcome).toBe('waiting_external');
      const state = (await model().findById(id))!.config!.managerState!;
      expect(state.turns).toBe(0);
      expect(Date.parse(state.retryAfter!)).toBe(resetsAt * 1000 + 60_000);
      expect(vi.mocked(scheduler.scheduleGoalAdvance)).toHaveBeenLastCalledWith(
        expect.objectContaining({ goalId: id, delay: expect.any(Number) }),
      );
      expect(
        vi.mocked(scheduler.scheduleGoalAdvance).mock.lastCall![0].delay,
      ).toBeGreaterThanOrEqual(600);

      // The sweep and Task events keep ticking before the reset; none of them
      // may dispatch a turn that would be refused the same way.
      for (let i = 0; i < 10; i++)
        expect((await service().tick(id)).outcome).toBe('waiting_external');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);

      vi.spyOn(Date, 'now').mockReturnValue(resetsAt * 1000 + 61_000);
      expect((await service().tick(id)).outcome).toBe('waiting_external');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
      expect((await model().findById(id))!.config!.managerState!.turns).toBe(1);
    });

    it('backs off and pauses on the error after consecutive failed turns', async () => {
      const { id, op } = await start(20);
      let now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
      let operationId = op.id;
      for (let failed = 1; failed <= MAX_FAILED_MANAGER_TURNS; failed++) {
        await ops().recordCompletion(operationId, {
          status: 'error',
          error: { message: 'spawn claude ENOENT' },
        });
        const result = await service().tick(id);
        const state = (await model().findById(id))!.config!.managerState!;
        if (failed === MAX_FAILED_MANAGER_TURNS) {
          expect(result.outcome).toBe('no_progress');
          expect(result.message).toContain('spawn claude ENOENT');
          // Whoever resumes the Goal starts from a fresh schedule.
          expect(state.failedTurns).toBeUndefined();
          break;
        }
        expect(state.failedTurns).toBe(failed);
        expect(result.outcome).toBe('waiting_external');
        expect(Date.parse(state.retryAfter!) - now).toBe(60_000 * 2 ** (failed - 1));
        expect((await service().tick(id)).outcome).toBe('waiting_external');
        expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(failed);
        now = Date.parse(state.retryAfter!) + 1;
        await service().tick(id);
        operationId = (await model().findById(id))!.config!.managerState!.operationId!;
      }
      clock.mockRestore();
      expect((await model().findById(id))!.status).toBe('paused');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(
        MAX_FAILED_MANAGER_TURNS,
      );
    });

    it('waits for an offline device on the Task schedule without charging the turn', async () => {
      vi.spyOn(deviceGateway, 'isConfigured', 'get').mockReturnValue(true);
      const list = vi.spyOn(deviceGateway, 'queryDeviceList').mockResolvedValue([]);
      const { id, op } = await start(3);
      const now = Date.now();
      await ops().recordCompletion(op.id, {
        status: 'error',
        error: {
          deviceRoute: { deviceId: 'device-laptop', userId },
          message: 'DEVICE_OFFLINE (HTTP 503)',
        },
      });

      expect((await service().tick(id)).outcome).toBe('waiting_external');
      const state = (await model().findById(id))!.config!.managerState!;
      expect(state.turns).toBe(0);
      expect(state.offlineTurns).toBe(1);
      expect(state.failedTurns).toBeUndefined();
      expect(Date.parse(state.retryAfter!) - now).toBeGreaterThanOrEqual(30 * 60_000 - 1000);

      // Still offline: no turn.
      expect((await service().tick(id)).outcome).toBe('waiting_external');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledWith(userId, undefined);

      // Back online before the scheduled retry: plan right away.
      list.mockResolvedValue([{ deviceId: 'device-laptop' } as never]);
      await service().tick(id);
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
    });

    it('pauses at once on an error only a person can fix', async () => {
      const { id, op } = await start(10);
      await ops().recordCompletion(op.id, {
        status: 'error',
        error: { category: 'quota', message: 'Insufficient balance' },
      });

      const result = await service().tick(id);
      expect(result.outcome).toBe('no_progress');
      expect(result.message).toContain('Insufficient balance');
      expect((await model().findById(id))!.status).toBe('paused');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    });

    it('pauses in the same transaction that consumes the failed turn', async () => {
      const { id, op } = await start(10);
      await ops().recordCompletion(op.id, {
        status: 'error',
        error: { category: 'auth', message: 'Invalid API key' },
      });
      // A concurrent tick that lands right after the settling transaction commits.
      const original = db.transaction.bind(db);
      let raced = false;
      vi.spyOn(db, 'transaction').mockImplementation((async (
        ...args: Parameters<typeof db.transaction>
      ) => {
        const result = await original(...args);
        const goal = await model().findById(id);
        if (!raced && goal?.config?.managerState?.consumed) {
          raced = true;
          await manager().advance(await service().graph(id));
        }
        return result;
      }) as typeof db.transaction);

      expect((await service().tick(id)).outcome).toBe('no_progress');
      expect(raced).toBe(true);
      expect((await model().findById(id))!.status).toBe('paused');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    });

    it('keeps a running turn plan valid when a Task arms its quota wake', async () => {
      const { id, state, op } = await start();
      expect(
        await model().armQuotaRetryWake(id, new Date(Date.now() + 3_600_000).toISOString()),
      ).toBe(true);
      await expect(manager().submit(id, state.token, op.id, taskPlan)).resolves.toBeDefined();
    });

    it('does not hold back the next turn after a committed plan whose run errored', async () => {
      const { id, state, op } = await start();
      await manager().submit(id, state.token, op.id, taskPlan);
      await ops().recordCompletion(op.id, { status: 'error', error: { message: 'late crash' } });
      expect((await service().tick(id)).outcome).not.toBe('no_progress');
      const settled = (await model().findById(id))!.config!.managerState!;
      expect(settled.retryAfter).toBeUndefined();
      expect(settled.failedTurns).toBeUndefined();
    });
  });

  it.each(['waiting_for_human', 'waiting_for_async_tool'] as const)(
    'retains ownership of a parked %s operation and requires confirmed cancellation',
    async (status) => {
      const { id, op, state } = await start();
      await db.update(agentOperations).set({ status }).where(eq(agentOperations.id, op.id));
      await service().tick(id);
      await service().tick(id);
      expect((await model().findById(id))!.config!.managerState!.consumed).not.toBe(true);
      expect((await model().findById(id))!.config!.managerState!.token).toBe(state.token);
      expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
      const interrupt = vi
        .spyOn(AiAgentService.prototype, 'interruptTask')
        .mockRejectedValue(new Error('Exit unconfirmed'));
      await expect(manager().stop(await service().graph(id))).rejects.toThrow('Exit unconfirmed');
      expect(interrupt).toHaveBeenCalledOnce();
    },
  );

  it('wakes the same main Topic after delivery and requests normal final verification', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, taskPlan);
    await ops().recordCompletion(op.id, { status: 'done' });
    await service().tick(id);
    const node = (await service().graph(id)).nodes.find((n) => n.kind === 'task')!;
    await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, node.id));
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const next = (await model().findById(id))!.config!.managerState!;
    expect(next.topicId).toBe(state.topicId);
    expect(next.token).not.toBe(state.token);
    const nextOp = (await ops().findByTopicSourceMessage(
      next.topicId,
      `msg_goal_manager_${next.token}`,
    ))!;
    await manager().submit(id, next.token, nextOp.id, {
      action: 'verify',
      reason: 'Evidence ready for independent verification',
    });
    expect((await model().findById(id))!.status).toBe('running');
    expect((await model().findById(id))!.config!.managerState!.readyForAcceptance).toBe(true);
  });

  it('keeps server-owned manager receipts across policy updates', async () => {
    const { id, state } = await start();
    await model().update(id, { config: { manager: { maxTurns: 5 } } });
    expect((await model().findById(id))!.config!.managerState).toEqual(state);
  });

  it('serializes concurrent duplicate plans without duplicate graph work', async () => {
    const { id, state, op } = await start();
    const results = await Promise.all([
      manager().submit(id, state.token, op.id, taskPlan),
      manager().submit(id, state.token, op.id, taskPlan),
    ]);
    expect(results.filter((r) => 'duplicate' in r)).toHaveLength(1);
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(1);
  });

  it('retains the live turn and pauses instead of replacing an unconfirmed timed-out process', async () => {
    const { id, state } = await start();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('no_progress');
    const fresh = (await model().findById(id))!;
    expect(fresh.status).toBe('paused');
    expect(fresh.config!.managerState!.token).toBe(state.token);
    expect(fresh.config!.managerState!.consumed).not.toBe(true);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('replaces a timed-out turn that never started instead of pausing on it', async () => {
    // A refused topic reservation — the planning topic was busy — is raised
    // before the planning message or any operation is written.
    const original = vi.mocked(AiAgentService.prototype.execAgent).getMockImplementation()!;
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async () => {
      throw new TopicStartReservationError('Topic tpc remained busy while starting operation x');
    });
    const { id, state, op } = await start();
    expect(op).toBeUndefined();
    expect((await model().findById(id))!.config!.managerState!.dispatchNeverStarted).toBe(true);

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('advanced');
    const settled = (await model().findById(id))!;
    expect(settled.status).toBe('running');
    expect(settled.config!.managerState!.token).toBe(state.token);
    expect(settled.config!.managerState!.consumed).toBe(true);

    vi.mocked(AiAgentService.prototype.execAgent).mockImplementation(original);
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const next = (await model().findById(id))!.config!.managerState!;
    expect(next.token).not.toBe(state.token);
    expect(next.turns).toBe(state.turns + 1);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
    // The replacement's message must not claim the refused turn ran and exited.
    const prompt = vi.mocked(AiAgentService.prototype.execAgent).mock.calls.at(-1)![0].prompt;
    expect(prompt).toContain('<previousTurn outcome="never_started" />');
  });

  it('keeps pausing when the planning message is deleted after a dispatch that had started', async () => {
    // The message was written and the call failed later, so a run may be live.
    // The owner then deletes the message from their conversation; a later
    // lookup must not turn that into "never started".
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async (params) => {
      await new MessageModel(db, userId).create(
        {
          agentId: params.agentId,
          content: 'plan',
          role: 'user',
          topicId: params.appContext!.topicId!,
        },
        params.clientIds!.userMessageId,
      );
      throw new Error('Topic metadata update failed');
    });
    const { id, state } = await start();
    expect(state.dispatchNeverStarted).toBeUndefined();
    await db.delete(messages).where(eq(messages.id, `msg_goal_manager_${state.token}`));

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('no_progress');
    const fresh = (await model().findById(id))!;
    expect(fresh.status).toBe('paused');
    expect(fresh.config!.managerState!.consumed).not.toBe(true);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('keeps pausing a turn whose dispatch failed for any reason other than a refused reservation', async () => {
    // No message and no operation, but an ordinary failure can come after a run
    // went live; only the error decides, never the absence of rows.
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async () => {
      throw new Error('Something failed while starting');
    });
    const { id, state } = await start();
    expect(state.dispatchNeverStarted).toBeUndefined();

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('no_progress');
    expect((await model().findById(id))!.status).toBe('paused');
  });

  /**
   * Regression: the pause asked the owner to "confirm its exit before resuming"
   * with no way to do so, so a Goal paused on a turn recorded before the
   * never-started verdict existed could not be resumed at all.
   */
  it('lets the owner confirm a stuck turn has ended and resume with a fresh one', async () => {
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(
      async (params) =>
        ({
          agentId: params.agentId!,
          operationId: 'op-lost',
          topicId: params.appContext!.topicId!,
        }) as any,
    );
    const { id, state } = await start();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    await service().tick(id);
    expect((await model().findById(id))!.status).toBe('paused');

    // A plain resume pauses again on the same turn.
    await service().resume(id);
    expect((await service().tick(id)).outcome).toBe('no_progress');

    expect(await manager().confirmTurnExit(id)).toBe(true);
    await service().resume(id);
    // The settled turn no longer holds the Goal: the next advance plans afresh.
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    expect((await model().findById(id))!.status).toBe('running');
    const next = (await model().findById(id))!.config!.managerState!;
    expect(next.token).not.toBe(state.token);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
  });

  it('refuses to confirm the exit of a turn whose run is still live', async () => {
    const { id } = await start();
    await expect(manager().confirmTurnExit(id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await model().findById(id))!.config!.managerState!.consumed).not.toBe(true);
  });

  it('keeps pausing a timed-out turn whose dispatch never reported failure', async () => {
    // No message and no operation, but the dispatch call never ended in an
    // error: it may still be initialising and start a paid run later, so the
    // turn cannot be replaced.
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(
      async (params) =>
        ({
          agentId: params.agentId!,
          operationId: 'op-still-starting',
          topicId: params.appContext!.topicId!,
        }) as any,
    );
    const { id, state, op } = await start();
    expect(op).toBeUndefined();

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('no_progress');
    const fresh = (await model().findById(id))!;
    expect(fresh.status).toBe('paused');
    expect(fresh.config!.managerState!.token).toBe(state.token);
    expect(fresh.config!.managerState!.consumed).not.toBe(true);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('keeps pausing a timed-out turn whose message exists but whose operation row is missing', async () => {
    // The runtime keeps running when its operation insert fails, so a written
    // planning message with no operation is still an unconfirmed process.
    vi.mocked(AiAgentService.prototype.execAgent).mockImplementationOnce(async (params) => {
      await new MessageModel(db, userId).create(
        {
          agentId: params.agentId,
          content: 'plan',
          role: 'user',
          topicId: params.appContext!.topicId!,
        },
        params.clientIds!.userMessageId,
      );
      throw new Error('Operation insert failed');
    });
    const { id, state, op } = await start();
    expect(op).toBeUndefined();

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 21 * 60_000);
    expect((await service().tick(id)).outcome).toBe('no_progress');
    const fresh = (await model().findById(id))!;
    expect(fresh.status).toBe('paused');
    expect(fresh.config!.managerState!.token).toBe(state.token);
    expect(fresh.config!.managerState!.consumed).not.toBe(true);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('rejects an open human Gate without planning or dispatching work', async () => {
    const { id, state, op } = await start();
    const graph = new GoalGraphModel(db, userId);
    const node = await graph.createNode(id, { kind: 'decision', title: 'Human approval' });
    await graph.createDecision(id, node!.id, { authority: 'user', question: 'Continue?' });
    await expect(manager().submit(id, state.token, op.id, taskPlan)).rejects.toThrow('human');
    expect((await service().tick(id)).outcome).toBe('waiting_human');
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(0);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it.each([{ maxRounds: 0 }, { maxTotalCost: 0 }])(
    'does not start a manager when Goal budget is exhausted: %j',
    async (limits) => {
      const graph = await service().create({
        title: 'No budget',
        config: { manager: {} },
        createdByAgentId: agentId,
      });
      await db.update(goals).set(limits).where(eq(goals.id, graph.goal.id));
      expect((await service().tick(graph.goal.id)).outcome).toBe('no_progress');
      expect(vi.mocked(AiAgentService.prototype.execAgent)).not.toHaveBeenCalled();
    },
  );

  it('recovers an eligible failure through the same Task in manager mode', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, taskPlan);
    await ops().recordCompletion(op.id, { status: 'done' });
    await service().tick(id);
    const created = await service().tick(id);
    const taskId = created.taskId!;
    const topicId = `failed-topic-${++seq}`;
    const failureId = `failed-op-${seq}`;
    await db.insert(topics).values({ id: topicId, userId });
    await ops().recordStart({ operationId: failureId, taskId, topicId });
    await ops().recordCompletion(failureId, {
      status: 'error',
      completionReason: 'error',
      error: { message: 'fetch failed: ECONNRESET' },
    });
    await db.insert(taskTopics).values({
      userId,
      taskId,
      topicId,
      operationId: failureId,
      seq: 1,
      status: 'failed',
      trigger: 'goal',
    });
    await new TaskModel(db, userId).update(taskId, {
      status: 'failed',
      error: 'ECONNRESET',
      totalTopics: 1,
    });
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const next = (await model().findById(id))!.config!.managerState!;
    expect(next.turns).toBe(2);
    const nextOp = (await ops().findByTopicSourceMessage(
      next.topicId,
      `msg_goal_manager_${next.token}`,
    ))!;
    await expect(
      manager().submit(id, next.token, nextOp.id, {
        action: 'retry',
        taskId,
        failedOperationId: 'wrong',
        reason: 'Reuse checkpoint',
      }),
    ).rejects.toThrow('Failure identity');
    await manager().submit(id, next.token, nextOp.id, {
      action: 'retry',
      taskId,
      failedOperationId: failureId,
      reason: 'Reuse checkpoint and retry delivery',
    });
    expect((await new TaskModel(db, userId).findById(taskId))!.status).toBe('backlog');
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(1);
  });

  it('retains a Goal when its main Agent exit cannot be confirmed before deletion', async () => {
    const { id } = await start();
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({
      success: false,
      deviceCancellationConfirmed: false,
    });
    await expect(service().delete(id)).rejects.toThrow('exit was not confirmed');
    expect(await model().findById(id)).toBeTruthy();
  });

  it('fences and re-reads a main turn claimed after the initial deletion read', async () => {
    const { id, op } = await start();
    await ops().recordCompletion(op.id, { status: 'done' });
    await service().tick(id);
    const deleting = service();
    const graphModel = deleting['graphModel'];
    const original = graphModel.getGraph;
    const read = vi.spyOn(graphModel, 'getGraph').mockImplementationOnce(async (goalId) => {
      const stale = await original(goalId);
      read.mockRestore();
      await manager().advance(stale!);
      return stale;
    });
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: false, deviceCancellationConfirmed: false });
    await expect(deleting.delete(id)).rejects.toThrow('exit was not confirmed');
    expect(interrupt).toHaveBeenCalledOnce();
    expect((await model().findById(id))!.status).toBe('paused');
  });

  it('retains the Goal if it is resumed while main cancellation is in flight', async () => {
    const { id } = await start();
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockImplementation(async () => {
      await model().updateStatus(id, 'running');
      return { success: true, deviceCancellationConfirmed: true };
    });
    await expect(service().delete(id)).rejects.toThrow('changed during cancellation');
    expect(await model().findById(id)).toBeTruthy();
  });

  it('delivers Task review feedback to the next planner and rejects a plan after newer feedback', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, taskPlan);
    await ops().recordCompletion(op.id, { status: 'done' });
    await service().tick(id);
    const created = await service().tick(id);
    const taskId = created.taskId!;
    const node = (await service().graph(id)).nodes.find((n) => n.taskId === taskId)!;
    await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, node.id));
    const taskModel = new TaskModel(db, userId);
    await taskModel.addComment({
      taskId,
      userId,
      authorUserId: userId,
      content:
        'The recommendation baseline is not a training majority; correct it before prediction.',
    });
    await service().tick(id);
    const prompt = vi.mocked(AiAgentService.prototype.execAgent).mock.calls.at(-1)![0].prompt;
    expect(prompt).toContain('The recommendation baseline is not a training majority');
    // Written after the previous turn started, so this turn shows it as new.
    expect(prompt).toMatch(
      /<feedback author="user" new="true"[^>]*><!\[CDATA\[\nThe recommendation baseline is not a training majority/,
    );
    // The card names the task by title; the agent keeps the id.
    expect(prompt).toContain(`taskId="${taskId}" taskTitle="Audit"`);
    expect(prompt).toContain('<previousTurn action="tasks" outcome="submitted">');
    const next = (await model().findById(id))!.config!.managerState!;
    await taskModel.addComment({
      taskId,
      userId,
      authorUserId: userId,
      content: 'New review: do not use future training cases.',
    });
    await expect(
      manager().submit(id, next.token, next.operationId!, { action: 'verify', reason: 'Ready' }),
    ).rejects.toThrow('feedback');
    expect((await model().findById(id))!.config!.managerState!.readyForAcceptance).not.toBe(true);
  });

  /**
   * Regression: the next turn's cutoff was taken after the comments were read,
   * so a comment committed in between was dated before a turn that never saw it
   * and the retry showed it only as a 200-character "earlier" excerpt.
   */
  it('shows a comment committed while the claim read feedback as new on the next turn', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, taskPlan);
    await ops().recordCompletion(op.id, { status: 'done' });
    await service().tick(id);
    const taskId = (await service().tick(id)).taskId!;
    const node = (await service().graph(id)).nodes.find((n) => n.taskId === taskId)!;
    await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, node.id));

    const original = TaskModel.prototype.getComments;
    const late = 'Late review: the baseline must exclude future cases.';
    const read = vi
      .spyOn(TaskModel.prototype, 'getComments')
      .mockImplementationOnce(async function (this: TaskModel, commentTaskId) {
        const seen = await original.call(this, commentTaskId);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const now = new Date();
        await this.addComment({
          taskId: commentTaskId,
          userId,
          authorUserId: userId,
          content: late,
          createdAt: now,
          updatedAt: now,
        });
        return seen;
      });
    await service().tick(id);
    read.mockRestore();
    const missed = vi.mocked(AiAgentService.prototype.execAgent).mock.calls.at(-1)![0].prompt;
    expect(missed).not.toContain(late);

    const turn = (await model().findById(id))!.config!.managerState!;
    await manager()
      .submit(id, turn.token, turn.operationId!, {
        action: 'escalate',
        reason: 'stale',
      })
      .catch(() => undefined);
    await ops().recordCompletion(turn.operationId!, { status: 'done' });
    await service().tick(id);
    await service().tick(id);
    const prompt = vi.mocked(AiAgentService.prototype.execAgent).mock.calls.at(-1)![0].prompt;
    expect(prompt).toMatch(
      new RegExp(String.raw`<feedback author="user" new="true"[^>]*><!\[CDATA\[\n${late}`),
    );
  });

  it('accepts a main Agent alongside the system planner', async () => {
    // Previously rejected outright. The two are layers now: the system planner
    // leads and the main Agent is handed what it cannot route, so configuring
    // both is the supported shape rather than a conflict.
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Other planner', maxExperiments: 2 },
        manager: {},
      },
      createdByAgentId: agentId,
      title: 'Mixed',
    });
    expect(graph.goal.agentId).toBe(agentId);
    expect(graph.goal.config).toMatchObject({
      exploration: { maxExperiments: 2 },
      manager: {},
    });
  });
});

/**
 * The two planners are ordered, not exclusive: the system's exploration planner
 * owns the ordinary path and a main Agent is the fallback for problems that
 * planner cannot express. Before this, `tick` asked the main Agent first and
 * returned early, so exploration never got a turn on a Goal that had both — and
 * the main Agent was never asked about a problem outside the transport
 * whitelist, which is why a Goal could park on a person for hours with a main
 * Agent configured and idle.
 */
describe('planner precedence', () => {
  const explored = (maxTurns = 4) =>
    service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns },
      },
      createdByAgentId: agentId,
      title: 'Explored research',
    });

  it('leaves the ordinary path to the system planner', async () => {
    const graph = await explored();
    await service().tick(graph.goal.id);
    expect((await model().findById(graph.goal.id))!.config!.managerState).toBeUndefined();
  });

  it('still settles a main Agent turn already in flight', async () => {
    const { id, state, op } = await start();
    const caller = operationCaller(op.id);
    await caller.submitOperationPlan({
      id,
      operationId: op.id,
      token: state.token,
      plan: taskPlan,
    });
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, op.id));
    const current = (await model().findById(id))!.config!;
    await model().update(id, {
      config: {
        ...current,
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
      },
    });
    // The turn was already paid for; declining to settle it would lose its plan.
    expect(
      await manager().advance((await service().graph(id))!, { mayStartTurn: false }),
    ).toMatchObject({ outcome: 'advanced' });
    expect((await model().findById(id))!.config!.managerState!.consumed).toBe(true);
  });

  it('hands the problem over instead of opening the gate', async () => {
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns: 4 },
        recovery: { maxAttemptsPerTask: 1 },
      },
      createdByAgentId: agentId,
      tasks: ['Measure ranking ability on the frozen holdout'],
      title: 'Explored research',
    });
    const created = await service().tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });

    await service().tick(graph.goal.id);

    expect((await model().findById(graph.goal.id))!.config!.managerState).toMatchObject({
      turns: 1,
    });
    expect((await service().graph(graph.goal.id)).decisions).toHaveLength(0);
  });

  it('opens the gate once the main Agent has had its turn and the block remains', async () => {
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns: 1 },
        recovery: { maxAttemptsPerTask: 1 },
      },
      createdByAgentId: agentId,
      tasks: ['Measure ranking ability on the frozen holdout'],
      title: 'Explored research',
    });
    const created = await service().tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });

    // Its one turn is handed over, then exits without changing anything.
    await service().tick(graph.goal.id);
    const state = (await model().findById(graph.goal.id))!.config!.managerState!;
    const turn = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );
    await db
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, turn!.id));
    await service().tick(graph.goal.id);

    // Out of turns, so the block goes back to its owner carrying the original
    // reason rather than "the main Agent is out of turns".
    expect(await service().tick(graph.goal.id)).toMatchObject({ outcome: 'waiting_human' });
    const gated = await service().graph(graph.goal.id);
    expect(gated.decisions).toHaveLength(1);
    expect(gated.decisions[0].question).toContain('Task attempt budget was exhausted');
    expect(gated.goal.status).not.toBe('paused');
  });
});

/**
 * Codex review on #19477 caught both of these: the newly allowed combinations
 * each broke an ordering the PR itself documented.
 */
describe('takeover ordering', () => {
  /**
   * Supervision is cheaper than a planning turn and stricter about who authored a
   * status. Allowing `manager` + `supervision` without `exploration` made `tick`
   * start an uninvited turn on a recognised transport failure before
   * `reviewFailure` could ever run, reversing the documented ladder.
   */
  it('consults supervision before starting a main Agent turn', async () => {
    const graph = await service().create({
      config: { manager: { maxTurns: 4 }, supervision: { enabled: true } },
      createdByAgentId: agentId,
      tasks: ['Collect the baseline'],
      title: 'Supervised research',
    });
    const created = await service().tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    await taskModel.updateStatus(created.taskId!, 'failed', { error: 'fetch failed' });

    await service().tick(graph.goal.id);

    // Before this, `tick` claimed the recognised transport failure with an
    // UNINVITED turn and returned early, so `decideNextMove` never reached the
    // `failure_decision` branch and the supervisor never saw it. The turn that
    // runs now is an invited one, which is only reachable through that branch —
    // `problem` is the receipt that it came down the documented ladder.
    expect((await model().findById(graph.goal.id))!.config!.managerState).toMatchObject({
      problem: `${created.taskId}::fetch failed`,
    });
  });

  /**
   * The takeover contract says `escalate` puts the Gate back one turn later. The
   * escalate branch only paused the Goal, so no answerable question existed and
   * later ticks sat on `goal_paused` forever.
   */
  it('turns a takeover escalation into the Gate it was holding', async () => {
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns: 4 },
        recovery: { maxAttemptsPerTask: 1 },
      },
      createdByAgentId: agentId,
      tasks: ['Measure ranking ability on the frozen holdout'],
      title: 'Explored research',
    });
    const created = await service().tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    await service().tick(graph.goal.id);

    const state = (await model().findById(graph.goal.id))!.config!.managerState!;
    expect(state.problem).toBe(`${created.taskId}::Task attempt budget was exhausted`);
    const turn = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );
    await operationCaller(turn!.id).submitOperationPlan({
      id: graph.goal.id,
      operationId: turn!.id,
      plan: { action: 'escalate', reason: 'The reproducibility criterion needs a human judge' },
      token: state.token,
    });
    // A takeover escalation must not park the Goal: the gate is opened by the tick
    // that follows, and a paused Goal never reaches it.
    expect((await model().findById(graph.goal.id))!.status).not.toBe('paused');
    await db
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, turn!.id));
    await service().tick(graph.goal.id);

    expect(await service().tick(graph.goal.id)).toMatchObject({ outcome: 'waiting_human' });
    const gated = await service().graph(graph.goal.id);
    expect(gated.decisions).toHaveLength(1);
    expect(gated.decisions[0].question).toContain('needs a human judge');
  });
});

/** A takeover-mode Goal whose only Task just spent its attempt budget. */
const stuckGoal = async (title = 'Explored research') => {
  const graph = await service().create({
    config: {
      exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
      manager: { maxTurns: 4 },
      recovery: { maxAttemptsPerTask: 1 },
    },
    createdByAgentId: agentId,
    tasks: ['Measure ranking ability on the frozen holdout'],
    title,
  });
  const created = await service().tick(graph.goal.id);
  const taskModel = new TaskModel(db, userId);
  await taskModel.update(created.taskId!, { totalTopics: 1 });
  await taskModel.updateStatus(created.taskId!, 'paused', {
    error: 'Delivery did not pass verification.',
  });
  await service().tick(graph.goal.id);
  const state = (await model().findById(graph.goal.id))!.config!.managerState!;
  const turn = await ops().findByTopicSourceMessage(
    state.topicId,
    `msg_goal_manager_${state.token}`,
  );
  return { goalId: graph.goal.id, state, taskId: created.taskId!, turn: turn! };
};

/**
 * Codex review round 2 on #19477. Both findings were about the takeover contract
 * promising more than the code would accept.
 */
describe('takeover submissions', () => {
  /**
   * The prompt advertises a corrective task, verification, a retry and escalation.
   * `submit` refused `tasks` and `verify` whenever any task node was unfinished —
   * which a takeover's inherited task always is — so only `escalate` could ever
   * commit and the other three were a contract the code broke.
   */
  it('accepts the corrective task a takeover was invited to plan', async () => {
    const { goalId, state, turn } = await stuckGoal();
    await expect(
      operationCaller(turn.id).submitOperationPlan({
        id: goalId,
        operationId: turn.id,
        plan: {
          action: 'tasks',
          reason: 'The previous run captured no evidence at all',
          tasks: [{ description: 'Rerun the scoring and register the report', title: 'Redo it' }],
        },
        token: state.token,
      }),
    ).resolves.toMatchObject({ success: true });
    expect((await service().graph(goalId)).nodes.some((node) => node.title === 'Redo it')).toBe(
      true,
    );
  });

  /**
   * Accepting the plan is not the same as the Goal moving. The inherited node
   * stayed nonterminal, so the next tick's frontier reached it before the new
   * corrective node and routed straight back to the Gate — the advertised action
   * committed and changed nothing.
   */
  it('retires the replaced work so the corrective task actually runs', async () => {
    const { goalId, state, taskId, turn } = await stuckGoal();
    await operationCaller(turn.id).submitOperationPlan({
      id: goalId,
      operationId: turn.id,
      plan: {
        action: 'tasks',
        reason: 'The previous run captured no evidence at all',
        tasks: [{ description: 'Rerun the scoring and register the report', title: 'Redo it' }],
      },
      token: state.token,
    });
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, turn.id));
    await service().tick(goalId);

    const graph = await service().graph(goalId);
    expect(graph.nodes.find((node) => node.taskId === taskId)!.status).toBe('retired');
    const moved = await service().tick(goalId);
    expect(moved.outcome).not.toBe('waiting_human');
    expect((await service().graph(goalId)).decisions).toHaveLength(0);
  });

  /**
   * "Task attempt budget was exhausted" is the same sentence for every task that
   * reaches it. Keying the already-answered check on the reason alone made a second
   * task skip its own takeover and inherit the first task's diagnosis in its gate.
   */
  it('gives a second task its own takeover despite an identical reason', async () => {
    const first = await stuckGoal('First research');
    await operationCaller(first.turn.id).submitOperationPlan({
      id: first.goalId,
      operationId: first.turn.id,
      plan: { action: 'escalate', reason: 'Needs a human judge' },
      token: first.state.token,
    });
    await db
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, first.turn.id));
    await service().tick(first.goalId);

    // A different Goal and task reaching the same wording must not be read as the
    // problem that was already answered.
    const second = await stuckGoal('Second research');
    expect(second.state.problem).toBe(`${second.taskId}::Task attempt budget was exhausted`);
    expect(second.state.problem).not.toBe(first.state.problem);
  });

  it('stops handing the same problem over once its turn has answered', async () => {
    const { goalId, state, turn } = await stuckGoal();
    await operationCaller(turn.id).submitOperationPlan({
      id: goalId,
      operationId: turn.id,
      plan: { action: 'escalate', reason: 'Needs a human judge' },
      token: state.token,
    });
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, turn.id));
    await service().tick(goalId);

    expect(await service().tick(goalId)).toMatchObject({ outcome: 'waiting_human' });
    const gated = await service().graph(goalId);
    expect(gated.decisions).toHaveLength(1);
    expect(gated.decisions[0].question).toContain('Needs a human judge');
  });
});

/**
 * Escalations used to carry only a reason, so the owner's gate offered retry /
 * retire while the actual decision — waive a criterion, restore a closed PR —
 * sat in the text with no button to answer it.
 */
describe('escalations that ask a real question', () => {
  const waiveAsk = {
    question: 'Waive the "in order" criterion for this delivery?',
    options: [
      {
        id: 'waive',
        label: 'Waive it',
        description: 'Accept the PRs in the order they merged',
        effect: 'retry' as const,
      },
      { id: 'keep', label: 'Keep it', effect: 'retire' as const },
    ],
    recommendedOptionId: 'waive',
  };

  it('opens a question gate instead of pausing an ordinary planning turn', async () => {
    const { id, state, op } = await start();
    await operationCaller(op.id).submitOperationPlan({
      id,
      operationId: op.id,
      token: state.token,
      plan: {
        action: 'escalate',
        reason: 'Both readings of the requirement are defensible',
        ask: {
          question: 'Should the report cover desktop only?',
          options: [
            { id: 'desktop', label: 'Desktop only' },
            { id: 'all', label: 'Desktop and mobile' },
          ],
        },
      },
    });

    const goal = (await model().findById(id))!;
    expect(goal.status).toBe('review');
    const graph = await service().graph(id);
    const node = graph.nodes.find((n) => n.title === GOAL_MANAGER_QUESTION_TITLE)!;
    expect(node).toMatchObject({
      description: 'Both readings of the requirement are defensible',
      kind: 'decision',
    });
    expect(graph.decisions).toEqual([
      expect.objectContaining({
        nodeId: node.id,
        options: [
          { id: 'desktop', label: 'Desktop only' },
          { id: 'all', label: 'Desktop and mobile' },
        ],
        question: 'Should the report cover desktop only?',
        status: 'pending',
      }),
    ]);

    // The answer is what the next turn plans from.
    await service().decide(id, graph.decisions[0].id, 'all', 'Mobile matters for this launch');
    expect((await model().findById(id))!.status).toBe('running');
    const answered = (await service().graph(id)).decisions[0];
    expect(answered).toMatchObject({
      resolution: 'Mobile matters for this launch',
      resolvedOptionId: 'all',
      status: 'resolved',
    });
  });

  it('asks a takeover question as written and carries the chosen answer into the retry', async () => {
    const { goalId, state, taskId, turn } = await stuckGoal();
    await operationCaller(turn.id).submitOperationPlan({
      id: goalId,
      operationId: turn.id,
      plan: { action: 'escalate', reason: 'The PRs merged out of order', ask: waiveAsk },
      token: state.token,
    });
    await db.update(agentOperations).set({ status: 'done' }).where(eq(agentOperations.id, turn.id));
    await service().tick(goalId);

    expect(await service().tick(goalId)).toMatchObject({ outcome: 'waiting_human' });
    const gated = await service().graph(goalId);
    expect(gated.decisions).toHaveLength(1);
    const [gate] = gated.decisions;
    expect(gate).toMatchObject({
      options: waiveAsk.options,
      question: waiveAsk.question,
      recommendedOptionId: 'waive',
    });
    expect(gated.nodes.find((n) => n.id === gate.nodeId)!.description).toContain(
      'The PRs merged out of order',
    );

    await service().decide(goalId, gate.id, 'waive', 'Order follows merge time');
    const task = await new TaskModel(db, userId).findById(taskId);
    expect(task!.status).toBe('backlog');
    const comments = await new TaskModel(db, userId).getComments(taskId);
    expect(comments.at(-1)!.content).toContain('Chosen: Waive it');
    expect(comments.at(-1)!.content).toContain('Guidance: Order follows merge time');
  });

  // Gates are labelled by option id, so an authored "retry" that retires the
  // Task would read "Retry task" on the card.
  it('refuses answers that reuse the coordinator option ids', async () => {
    const { goalId, state, turn } = await stuckGoal();
    await expect(
      operationCaller(turn.id).submitOperationPlan({
        id: goalId,
        operationId: turn.id,
        plan: {
          action: 'escalate',
          reason: 'Needs a call',
          ask: {
            question: 'Keep this result?',
            options: [
              { id: 'retry', label: 'Keep this result', effect: 'retire' },
              { id: 'redo', label: 'Redo it', effect: 'retry' },
            ],
          },
        },
        token: state.token,
      }),
    ).rejects.toThrow('reserved');
  });

  it('refuses a takeover question whose answers leave the blocked Task undecided', async () => {
    const { goalId, state, turn } = await stuckGoal();
    await expect(
      operationCaller(turn.id).submitOperationPlan({
        id: goalId,
        operationId: turn.id,
        plan: {
          action: 'escalate',
          reason: 'Needs a judge',
          ask: {
            question: 'Which judge?',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        },
        token: state.token,
      }),
    ).rejects.toThrow('needs an effect');
  });
});

/**
 * Codex review round 4. The acceptance guard was written for uninvited turns
 * ("verification exists, stop planning more work") but sat above the invited
 * branch, so a takeover invited BECAUSE the terminal acceptance failed could never
 * start and the Goal still reached a bare Gate with a main Agent idle.
 */
describe('takeover on a failed terminal acceptance', () => {
  const failedAcceptance = async () => {
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns: 4 },
        recovery: { maxAttemptsPerTask: 1 },
      },
      createdByAgentId: agentId,
      requirement: 'Return a defensible training recommendation.',
      tasks: [GOAL_ACCEPTANCE_TASK_TITLE],
      title: 'Explored research',
    });
    const created = await service().tick(graph.goal.id);
    const taskModel = new TaskModel(db, userId);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    await service().tick(graph.goal.id);
    return { goalId: graph.goal.id, taskId: created.taskId! };
  };

  it('hands a failed terminal acceptance to the main Agent', async () => {
    const { goalId, taskId } = await failedAcceptance();
    expect((await model().findById(goalId))!.config!.managerState).toMatchObject({
      problemTaskId: taskId,
    });
    expect((await service().graph(goalId)).decisions).toHaveLength(0);
  });

  /**
   * A failed acceptance cannot be superseded: the acceptance task is matched by TITLE
   * regardless of status, so a corrective task returns to that same failed node and
   * `verify` sets `readyForAcceptance` without producing a fresh run. Refusing keeps
   * the prompt's offer and the server's answer identical instead of accepting a plan
   * that strands.
   */
  it('accepts only an escalation for a failed acceptance', async () => {
    const { goalId, taskId } = await failedAcceptance();
    const state = (await model().findById(goalId))!.config!.managerState!;
    const turn = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );
    const caller = operationCaller(turn!.id);
    await expect(
      caller.submitOperationPlan({
        id: goalId,
        operationId: turn!.id,
        plan: {
          action: 'tasks',
          reason: 'The judge read evidence it was never shown',
          tasks: [{ description: 'Recapture the evidence and redeliver', title: 'Recapture' }],
        },
        token: state.token,
      }),
    ).rejects.toThrow('can only be escalated');
    await expect(
      caller.submitOperationPlan({
        id: goalId,
        operationId: turn!.id,
        plan: { action: 'escalate', reason: 'The judge read evidence it was never shown' },
        token: state.token,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(
      (await service().graph(goalId)).nodes.find((node) => node.taskId === taskId)!.status,
    ).not.toBe('retired');
  });
});

/**
 * Codex review round 5, dependency half. A prerequisite only counts as met when it is
 * `resolved`, so retiring a node something depends on leaves the dependent blocked and
 * the Goal lands on `no_frontier` — and the graph has no edge removal, so the
 * dependents cannot be rewired onto the replacement.
 */
describe('takeover and dependent work', () => {
  it('leaves stuck work that something depends on for the Gate', async () => {
    const graph = await service().create({
      config: {
        exploration: { instruction: 'Follow the pre-registered branches', maxExperiments: 4 },
        manager: { maxTurns: 4 },
        recovery: { maxAttemptsPerTask: 1 },
      },
      createdByAgentId: agentId,
      tasks: ['Measure ranking ability'],
      title: 'Explored research',
    });
    const created = await service().tick(graph.goal.id);
    const blockedNode = (await service().graph(graph.goal.id)).nodes.find(
      (node) => node.taskId === created.taskId,
    )!;
    const problem = (await service().graph(graph.goal.id)).nodes.find(
      (node) => node.kind === 'problem',
    )!;
    const dependent = await service().addNode(graph.goal.id, {
      kind: 'task',
      title: 'Train the head',
    });
    await service().addEdge(graph.goal.id, problem.id, dependent!.id, 'decomposes');
    await service().addEdge(graph.goal.id, dependent!.id, blockedNode.id, 'depends_on');
    const taskModel = new TaskModel(db, userId);
    await taskModel.update(created.taskId!, { totalTopics: 1 });
    await taskModel.updateStatus(created.taskId!, 'paused', {
      error: 'Delivery did not pass verification.',
    });
    await service().tick(graph.goal.id);

    const state = (await model().findById(graph.goal.id))!.config!.managerState!;
    const turn = await ops().findByTopicSourceMessage(
      state.topicId,
      `msg_goal_manager_${state.token}`,
    );
    await operationCaller(turn!.id).submitOperationPlan({
      id: graph.goal.id,
      operationId: turn!.id,
      plan: {
        action: 'tasks',
        reason: 'Replace the stuck measurement',
        tasks: [{ description: 'Measure again from the frozen inputs', title: 'Measure again' }],
      },
      token: state.token,
    });

    // Retiring it would strand "Train the head" behind a prerequisite that can never
    // resolve, so the node keeps its status and the block stays visible to a person.
    expect(
      (await service().graph(graph.goal.id)).nodes.find((node) => node.id === blockedNode.id)!
        .status,
    ).not.toBe('retired');
  });
});

describe('durable manager continuation', () => {
  const waits = () => new GoalWaitService(db, userId);
  const event = { type: 'external.result', key: 'experiment-1', eventId: 'delivery-1' };
  const finish = async (id: string, operationId: string) => {
    await ops().recordCompletion(operationId, { status: 'done' });
    await service().tick(id);
  };
  const begin = async () => {
    const run = await start();
    await manager().submit(run.id, run.state.token, run.op.id, {
      action: 'wait',
      reason: 'Await external evidence',
      until: new Date(Date.now() + 60_000).toISOString(),
      event: { type: event.type, key: event.key },
    });
    return run;
  };

  it('persists a bounded wait without paying for another planning turn', async () => {
    const { id, op } = await begin();
    await finish(id, op.id);
    expect((await service().tick(id)).outcome).toBe('waiting_external');
    const goal = await model().findById(id);
    expect(goal?.status).toBe('running');
    expect(goal?.config?.managerState).toMatchObject({
      consumed: true,
      turns: 1,
      submitted: { action: 'wait' },
    });
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    expect(
      (await GoalModel.listStalled(db, { staleBefore: new Date() })).map((g) => g.id),
    ).not.toContain(id);
  });

  it('arms one wake per scheduled check instead of one per poll', async () => {
    const wakes = () =>
      vi
        .mocked(scheduler.scheduleGoalAdvance)
        .mock.calls.filter(([input]) => input.goalId === id && input.trigger === 'wake');
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, {
      action: 'wait',
      reason: 'Await a slow external result',
      until: new Date(Date.now() + 3 * 86400_000).toISOString(),
    });
    await finish(id, op.id);
    for (let i = 0; i < 5; i++) expect((await service().tick(id)).outcome).toBe('waiting_external');
    expect(wakes()).toHaveLength(1);
    // The armed check fires after the 24h queue bound; the wait re-arms once.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400_000 + 1000);
    for (let i = 0; i < 5; i++) expect((await service().tick(id)).outcome).toBe('waiting_external');
    expect(wakes()).toHaveLength(2);
    expect(wakes()[1][0].delay).toBeGreaterThan(86000);
  });

  it('retains an early event, rejects duplicates and fences later waits', async () => {
    const { id, state, op } = await begin();
    expect(await waits().deliver(id, { ...event, waitToken: 'stale' })).toMatchObject({
      accepted: false,
    });
    expect(
      await waits().deliver(id, { ...event, waitToken: state.token, key: 'wrong' }),
    ).toMatchObject({ accepted: false });
    expect(
      await waits().deliver(id, { ...event, waitToken: state.token, reference: 'experiment:1' }),
    ).toMatchObject({ accepted: true });
    expect(await waits().deliver(id, { ...event, waitToken: state.token })).toMatchObject({
      accepted: false,
      reason: 'already_woken',
    });
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    await finish(id, op.id);
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(AiAgentService.prototype.execAgent).mock.calls[1][0].prompt).toContain(
      'experiment:1',
    );
    const next = (await model().findById(id))!.config!.managerState!;
    await manager().submit(id, next.token, next.operationId!, {
      action: 'wait',
      reason: 'Next observation',
      until: new Date(Date.now() + 60_000).toISOString(),
      event: { type: event.type, key: event.key },
    });
    expect(await waits().deliver(id, { ...event, waitToken: state.token })).toMatchObject({
      accepted: false,
      reason: 'unmatched',
    });
    expect((await model().findById(id))!.config!.managerState!.wait?.wake).toBeUndefined();
  });

  it('does not expose a personal Goal to another user', async () => {
    const { id, state } = await begin();
    await expect(
      new GoalWaitService(db, 'another-user').deliver(id, { ...event, waitToken: state.token }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps a user pause through an event and elapsed timer until explicit resume', async () => {
    const { id, state, op } = await begin();
    await finish(id, op.id);
    await service().pause(id);
    expect(await waits().deliver(id, { ...event, waitToken: state.token })).toMatchObject({
      accepted: false,
      reason: 'stopped',
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    await service().tick(id);
    expect((await model().findById(id))?.status).toBe('paused');
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
    await service().resume(id);
    await service().tick(id);
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
  });

  it('recovers an elapsed persisted wait after service recreation via the sweep', async () => {
    const { id, op } = await begin();
    await finish(id, op.id);
    const goal = (await model().findById(id))!;
    const state = goal.config!.managerState!;
    // Let database time observe an elapsed deadline without a real minute-long test.
    await db
      .update(goals)
      .set({
        config: {
          ...goal.config,
          managerState: {
            ...state,
            wait: { ...state.wait!, until: new Date(Date.now() - 1000).toISOString() },
          },
        },
      })
      .where(eq(goals.id, id));
    expect(
      (await GoalModel.listStalled(db, { staleBefore: new Date() })).map((g) => g.id),
    ).toContain(id);
    await new GoalService(db, userId).tick(id);
    await new GoalService(db, userId).tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
  });

  it('ignores historical measurements but wakes on a fresh below-target observation', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, {
      action: 'wait',
      reason: 'Observe progress',
      until: new Date(Date.now() + 60_000).toISOString(),
      event: { type: 'metric.observed', key: 'score' },
    });
    await finish(id, op.id);
    await service().setMetricCriteria(id, [{ key: 'score', target: 100 }]);
    await service().recordObservation(id, {
      key: 'score',
      value: 1,
      observedAt: new Date(Date.now() - 86400_000),
    });
    expect((await model().findById(id))!.config!.managerState!.wait?.wake).toBeUndefined();
    await service().recordObservation(id, { key: 'score', value: 2 });
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(2);
    expect((await model().findById(id))!.config!.acceptance?.metrics).toEqual([
      { key: 'score', target: 100 },
    ]);
  });

  it('returns an unmet measured contract to planning and accepts another experiment', async () => {
    const { id, state, op } = await start();
    await manager().submit(id, state.token, op.id, taskPlan);
    const node = (await service().graph(id)).nodes.find((n) => n.kind === 'task')!;
    await new GoalGraphModel(db, userId).updateNodeStatus(id, node.id, 'resolved');
    await finish(id, op.id);
    await service().setMetricCriteria(id, [{ key: 'score', target: 100 }]);
    await service().tick(id);
    const next = (await model().findById(id))!.config!.managerState!;
    await manager().submit(id, next.token, next.operationId!, {
      action: 'verify',
      reason: 'Evaluate evidence',
    });
    await finish(id, next.operationId!);
    expect((await service().tick(id)).outcome).toBe('advanced');
    expect((await model().findById(id))?.status).toBe('running');
    await service().tick(id);
    expect(vi.mocked(AiAgentService.prototype.execAgent).mock.calls[2][0].prompt).toContain(
      'Measured acceptance not met',
    );
    const third = (await model().findById(id))!.config!.managerState!;
    await manager().submit(id, third.token, third.operationId!, taskPlan);
    expect((await service().graph(id)).nodes.filter((n) => n.kind === 'task')).toHaveLength(2);
  });

  it('invites the first manager turn after exploration reaches unmet acceptance', async () => {
    const graph = await service().create({
      title: 'Measured exploration',
      agentId,
      config: {
        manager: { maxTurns: 3 },
        exploration: { instruction: 'Explore', maxExperiments: 2 },
      },
    });
    for (const node of graph.nodes.filter((n) => n.kind !== 'problem'))
      await db.update(goalNodes).set({ status: 'resolved' }).where(eq(goalNodes.id, node.id));
    expect(
      (
        await manager().reconsiderAcceptance(
          await service().graph(graph.goal.id),
          'Measured acceptance not met: score',
        )
      )?.outcome,
    ).toBe('waiting_external');
    expect(vi.mocked(AiAgentService.prototype.execAgent).mock.calls[0][0].prompt).toContain(
      'Measured acceptance not met: score',
    );
  });

  it('rejects elapsed waits and unfinished work', async () => {
    const { id, state, op } = await start();
    await expect(
      manager().submit(id, state.token, op.id, {
        action: 'wait',
        reason: 'Elapsed',
        until: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await new GoalGraphModel(db, userId).createNode(id, { kind: 'task', title: 'Pending work' });
    await expect(
      manager().submit(id, state.token, op.id, {
        action: 'wait',
        reason: 'Pending',
        until: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('decideFailedTurn', () => {
  const now = Date.parse('2026-10-05T19:49:30Z');

  it('waits for the reported quota reset and does not charge the turn', () => {
    const resetsAt = Math.floor(now / 1000) + 3600;
    expect(
      decideFailedTurn(
        { category: 'quota', body: { code: 'rate_limit', rateLimitInfo: { resetsAt } } },
        { failedTurns: 2 },
        now,
      ),
    ).toMatchObject({
      action: 'retry',
      charged: false,
      failedTurns: 2,
      retryAfter: new Date(resetsAt * 1000 + 60_000).toISOString(),
    });
  });

  it('follows the Task offline schedule for an unreachable device, then pauses', () => {
    const offline = { message: 'DEVICE_OFFLINE' };
    const delays = [0, 1, 2, 3, 4, 5].map((offlineTurns) => {
      const decision = decideFailedTurn(offline, { offlineTurns }, now);
      expect(decision).toMatchObject({ action: 'retry', charged: false });
      return decision.action === 'retry' ? Date.parse(decision.retryAfter) - now : 0;
    });
    const HOUR = 60 * 60_000;
    expect(delays).toEqual([HOUR / 2, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 8 * HOUR]);
    expect(decideFailedTurn(offline, { offlineTurns: 6 }, now).action).toBe('pause');
  });

  it('restarts the offline schedule after a failure that reached the device', () => {
    const between = decideFailedTurn({ message: 'boom' }, { offlineTurns: 3 }, now);
    expect(between).toMatchObject({ action: 'retry', offlineTurns: 0 });
    const next = decideFailedTurn({ message: 'DEVICE_OFFLINE' }, { offlineTurns: 0 }, now);
    expect(next.action === 'retry' && Date.parse(next.retryAfter) - now).toBe(30 * 60_000);
  });

  it('pauses at once when a person has to act', () => {
    for (const error of [
      { category: 'auth', message: 'Invalid API key' },
      { category: 'quota', message: 'Insufficient balance' },
      // A session limit without a reset time cannot be waited out.
      { body: { code: 'rate_limit' }, category: 'quota', message: 'session limit' },
    ])
      expect(decideFailedTurn(error, {}, now).action).toBe('pause');
  });

  it('backs off transient and unknown errors, then pauses on the fifth in a row', () => {
    const delays = [0, 1, 2, 3].map((failedTurns) => {
      const decision = decideFailedTurn({ message: 'boom' }, { failedTurns }, now);
      expect(decision).toMatchObject({ action: 'retry', charged: true });
      return decision.action === 'retry' ? Date.parse(decision.retryAfter) - now : 0;
    });
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(
      decideFailedTurn({ category: 'capacity', message: '429' }, { failedTurns: 4 }, now),
    ).toMatchObject({ action: 'pause', reason: expect.stringContaining('5 turns') });
  });

  it('charges a quota error whose reset has already passed like any other failure', () => {
    const past = Math.floor(now / 1000) - 600;
    expect(
      decideFailedTurn({ category: 'quota', body: { rateLimitInfo: { resetsAt: past } } }, {}, now),
    ).toMatchObject({ action: 'retry', charged: true });
  });
});
