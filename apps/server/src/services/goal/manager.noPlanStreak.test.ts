// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import {
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodes,
  goals,
  messages,
  topics,
  users,
} from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import { GoalManagerService } from './manager';
import { MAX_NO_PLAN_MANAGER_TURNS } from './manager/failedTurn';
import * as scheduler from './scheduler';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));

const db = await getTestDB();
const userId = 'goal-no-plan-streak-user';
const agentId = 'goal-no-plan-streak-agent';
let seq = 0;
const service = () => new GoalService(db, userId);
const manager = () => new GoalManagerService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);
const managerState = async (id: string) => (await model().findById(id))!.config!.managerState!;

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-no-plan-streak-${++seq}`;
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
  for (const table of [goalEdges, goalEvents, goalNodes, goals, agentOperations, messages, topics])
    await db.delete(table);
  await db.delete(agents);
  await db.delete(users);
});

async function startGoal() {
  const config = { manager: { maxTurns: 20 } };
  const graph = await service().create({
    config,
    createdByAgentId: agentId,
    title: 'Managed research',
  });
  // Keep the manager's own path: supervision would take over failed turns.
  await db.update(goals).set({ config }).where(eq(goals.id, graph.goal.id));
  expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
  return graph.goal.id;
}

/** End the running turn with `status` and no plan, and settle it. */
const endTurn = async (id: string, status: 'done' | 'interrupted' = 'done') => {
  const { operationId } = await managerState(id);
  await ops().recordCompletion(operationId!, { status });
  return service().tick(id);
};

/**
 * Regression: an Agent whose `lh` cannot sign in says so and finishes normally.
 * Only errored turns had a limit, so these were re-dispatched until the Goal's
 * whole turn budget was spent.
 */
describe('GoalManagerService with turns that finish without a plan', () => {
  it('pauses on the limit with guidance instead of dispatching again', async () => {
    const id = await startGoal();

    for (let turn = 1; turn < MAX_NO_PLAN_MANAGER_TURNS; turn++) {
      expect((await endTurn(id)).outcome).toBe('advanced');
      expect((await managerState(id)).noPlanTurns).toBe(turn);
      await service().tick(id);
    }
    const result = await endTurn(id);

    expect(result.outcome).toBe('no_progress');
    expect(result.message).toContain('lh login');
    expect(result.message).toContain(`lh goal resume ${id}`);
    expect((await model().findById(id))!.status).toBe('paused');
    expect((await managerState(id)).noPlanTurns).toBeUndefined();
    expect(vi.mocked(AiAgentService.prototype.execAgent)).toHaveBeenCalledTimes(
      MAX_NO_PLAN_MANAGER_TURNS,
    );
  });

  it('does not count a run that was stopped', async () => {
    const id = await startGoal();

    expect((await endTurn(id, 'interrupted')).outcome).toBe('advanced');

    expect((await managerState(id)).noPlanTurns).toBeUndefined();
  });

  it('resets the streak when a turn commits a plan', async () => {
    const id = await startGoal();
    await endTurn(id);
    await service().tick(id);
    const state = await managerState(id);
    expect(state.noPlanTurns).toBe(1);

    await manager().submit(id, state.token, state.operationId!, {
      action: 'tasks',
      reason: 'Audit first',
      tasks: [{ description: 'Count the evidence', title: 'Audit' }],
    });
    await ops().recordCompletion(state.operationId!, { status: 'done' });
    await service().tick(id);

    expect((await managerState(id)).noPlanTurns).toBeUndefined();
  });

  it('declines an invitation after the streak, so the gate keeps the real problem', async () => {
    const id = await startGoal();
    const state = await managerState(id);
    await ops().recordCompletion(state.operationId!, { status: 'done' });
    await db
      .update(goals)
      .set({
        config: {
          manager: { maxTurns: 20 },
          managerState: {
            ...state,
            consumed: true,
            noPlanTurns: MAX_NO_PLAN_MANAGER_TURNS,
            problem: 'goal::stuck',
          },
        },
      })
      .where(eq(goals.id, id));
    vi.mocked(AiAgentService.prototype.execAgent).mockClear();

    const result = await manager().takeOver(await service().graph(id), { reason: 'other' });

    expect(result).toBeNull();
    expect(AiAgentService.prototype.execAgent).not.toHaveBeenCalled();
    expect((await model().findById(id))!.status).not.toBe('paused');
    expect((await managerState(id)).noPlanTurns).toBeUndefined();
  });
});
