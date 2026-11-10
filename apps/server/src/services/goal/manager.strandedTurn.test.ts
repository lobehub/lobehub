// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
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
import * as scheduler from './scheduler';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));

const db = await getTestDB();
const userId = 'goal-stranded-turn-user';
const agentId = 'goal-stranded-turn-agent';
const service = () => new GoalService(db, userId);
const model = () => new GoalModel(db, userId);

/** Rewrite the claimed turn's receipt, e.g. to age it past a timeout. */
const editReceipt = async (goalId: string, patch: Record<string, unknown>) => {
  const goal = await model().findById(goalId);
  const config = goal!.config!;
  await db
    .update(goals)
    .set({ config: { ...config, managerState: { ...config.managerState!, ...patch } } })
    .where(eq(goals.id, goalId));
};
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000).toISOString();

const managedGoal = async () => {
  const graph = await service().create({
    config: { manager: { maxTurns: 4 } },
    createdByAgentId: agentId,
    title: 'Stranded planning',
  });
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns: 4 } } })
    .where(eq(goals.id, graph.goal.id));
  return graph.goal.id;
};

const started = (params: Parameters<AiAgentService['execAgent']>[0], operationId: string) => ({
  agentId: params.agentId!,
  assistantMessageId: 'm',
  autoStarted: true,
  createdAt: new Date().toISOString(),
  message: 'started',
  operationId,
  status: 'running',
  success: true,
  timestamp: new Date().toISOString(),
  topicId: params.appContext!.topicId!,
  userMessageId: 'u',
});

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [goalEdges, goalEvents, goalNodes, goals, agentOperations, messages, topics])
    await db.delete(table);
  await db.delete(agents);
  await db.delete(users);
});

describe('GoalManagerService with a planning turn whose dispatch never wrote a run', () => {
  // The production failure: `execAgent` failed on a database timeout before
  // writing the planning message or the operation.
  it('lets the owner close the goal once the failed dispatch is past the turn timeout', async () => {
    const goalId = await managedGoal();
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockRejectedValue(
      new Error('timeout exceeded when trying to connect'),
    );
    await service().tick(goalId);
    const receipt = (await model().findById(goalId))!.config!.managerState!;
    expect(receipt.dispatchReturnedWithoutRun).toBe(true);

    await editReceipt(goalId, { startedAt: hoursAgo(2) });
    expect((await service().close(goalId, 'achieved')).status).toBe('achieved');
  });

  it('refuses to settle a turn whose dispatch may still be pending', async () => {
    const goalId = await managedGoal();
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
      await editReceipt(goalId, { startedAt: hoursAgo(2) });
      await expect(service().close(goalId, 'achieved')).rejects.toThrow(/not closed/);
      return started(params, 'op-stranded-pending') as never;
    });

    await service().tick(goalId);
    expect((await model().findById(goalId))!.config!.managerState!.consumed).toBeFalsy();
  });
});

/**
 * A dispatch that returns after the owner settled its turn has a run nothing
 * else will stop, so the dispatch stops it itself.
 */
describe('GoalManagerService with a dispatch that returns after the owner settled the turn', () => {
  it('interrupts the late run of a closed goal', async () => {
    const goalId = await managedGoal();
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true } as never);
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
      await editReceipt(goalId, { startedAt: hoursAgo(25) });
      expect((await service().close(goalId, 'achieved')).status).toBe('achieved');
      return started(params, 'op-stranded-late') as never;
    });

    await service().tick(goalId);

    expect(interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-stranded-late' }),
    );
    expect((await model().findById(goalId))!.status).toBe('achieved');
  });

  it('interrupts the late run once a newer turn replaced its receipt', async () => {
    const goalId = await managedGoal();
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true } as never);
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
      await editReceipt(goalId, { startedAt: hoursAgo(25) });
      await service().close(goalId, 'achieved');
      // Reopened, and the next tick claimed a fresh turn.
      await editReceipt(goalId, { consumed: false, token: 'newer-turn' });
      return started(params, 'op-stranded-superseded') as never;
    });

    await service().tick(goalId);

    expect(interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-stranded-superseded' }),
    );
  });

  it('keeps an unconfirmed late run stoppable by pausing the closed goal', async () => {
    const goalId = await managedGoal();
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({
      deviceCancellationConfirmed: false,
      success: true,
    } as never);
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
      await editReceipt(goalId, { startedAt: hoursAgo(25) });
      await service().close(goalId, 'achieved');
      return started(params, 'op-stranded-unconfirmed') as never;
    });

    await service().tick(goalId);

    const goal = (await model().findById(goalId))!;
    expect(goal.status).toBe('paused');
    expect(goal.config!.managerState).toMatchObject({
      consumed: false,
      operationId: 'op-stranded-unconfirmed',
    });
  });
});
