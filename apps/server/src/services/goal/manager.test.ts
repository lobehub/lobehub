// @vitest-environment node
import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
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

  it('explicitly dispatches the creator instead of the default Task assignee', async () => {
    await db.insert(agents).values({ id: 'task-worker', userId });
    const graph = await service().create({
      agentId: 'task-worker',
      createdByAgentId: agentId,
      title: 'Creator-managed goal',
      config: { manager: {} },
    });
    expect(graph.goal.config?.manager?.agentId).toBe(agentId);
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
    expect(graph.goal.config?.manager?.agentId).toBe(agentId);
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

  it('cannot select a different manager through a legacy config object', async () => {
    const config = { manager: { agentId: 'unrelated-agent', maxTurns: 5 } };
    const graph = await service().create({
      createdByAgentId: agentId,
      config,
      title: 'Bound creator',
    });
    expect(graph.goal.config?.manager).toEqual({ agentId, maxTurns: 5 });
    await db.insert(agents).values({ id: 'new-task-worker', userId });
    await service().setAgent(graph.goal.id, 'new-task-worker');
    expect((await model().findById(graph.goal.id))?.config?.manager?.agentId).toBe(agentId);
  });

  it('requires an accessible creator when planning options are supplied', async () => {
    await expect(
      service().create({ title: 'Missing creator', config: { manager: {} } }),
    ).rejects.toThrow('creating or selected Agent');
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
    expect((await service().tick(id)).outcome).toBe('advanced');
    expect((await service().tick(id)).outcome).toBe('no_progress');
    expect((await model().findById(id))!.status).toBe('paused');
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(1);
  });

  it('rejects a delayed claim after another turn has consumed the remaining budget', async () => {
    const { id, op } = await start(2);
    await ops().recordCompletion(op.id, { status: 'error' });
    await service().tick(id);
    const stale = await service().graph(id);
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
    await model().update(id, { config: { manager: { agentId, maxTurns: 5 } } });
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
    expect(graph.goal.config).toMatchObject({
      exploration: { maxExperiments: 2 },
      manager: { agentId },
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

/**
 * Codex review round 2 on #19477. Both findings were about the takeover contract
 * promising more than the code would accept.
 */
describe('takeover submissions', () => {
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
