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

/** Age the claimed turn past the manager's turn timeout. */
const ageTurn = async (goalId: string) => {
  const goal = await model().findById(goalId);
  const config = goal!.config!;
  await db
    .update(goals)
    .set({
      config: {
        ...config,
        managerState: {
          ...config.managerState!,
          startedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        },
      },
    })
    .where(eq(goals.id, goalId));
};

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

/**
 * A dispatch that hangs past the turn timeout lets the owner close the Goal and
 * settle the turn as never started; when `execAgent` finally returns, its run
 * must be stopped rather than left spending on an ended Goal.
 */
describe('GoalManagerService with a dispatch that returns after the owner settled the turn', () => {
  it('interrupts the late run', async () => {
    const graph = await service().create({
      config: { manager: { maxTurns: 4 } },
      createdByAgentId: agentId,
      title: 'Stranded planning',
    });
    const goalId = graph.goal.id;
    await db
      .update(goals)
      .set({ config: { manager: { maxTurns: 4 } } })
      .where(eq(goals.id, goalId));
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true } as never);
    vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
      // While this dispatch is still pending, the owner closes the Goal.
      await ageTurn(goalId);
      expect((await service().close(goalId, 'achieved')).status).toBe('achieved');
      return {
        agentId: params.agentId!,
        assistantMessageId: 'm',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'started',
        operationId: 'op-stranded-late',
        status: 'running',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: params.appContext!.topicId!,
        userMessageId: 'u',
      };
    });

    await service().tick(goalId);

    expect(interrupt).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-stranded-late' }),
    );
    expect((await model().findById(goalId))!.status).toBe('achieved');
  });
});
