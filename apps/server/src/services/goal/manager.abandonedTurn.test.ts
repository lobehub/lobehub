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
import * as scheduler from './scheduler';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));

const db = await getTestDB();
const userId = 'goal-abandoned-turn-user';
const agentId = 'goal-abandoned-turn-agent';
let seq = 0;
const service = () => new GoalService(db, userId);
const manager = () => new GoalManagerService(db, userId);
const model = () => new GoalModel(db, userId);
const ops = () => new AgentOperationModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values({ id: agentId, userId });
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-abandoned-turn-${++seq}`;
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

/** A manager-mode Goal whose first planning turn's run was then abandoned. */
async function goalWithAbandonedTurn() {
  const graph = await service().create({
    config: { manager: { maxTurns: 4 } },
    createdByAgentId: agentId,
    title: 'Managed research',
  });
  // Keep the manager's own path: supervision would take over failed turns.
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns: 4 } } })
    .where(eq(goals.id, graph.goal.id));
  expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
  const state = (await model().findById(graph.goal.id))!.config!.managerState!;
  const op = await ops().findByTopicSourceMessage(state.topicId, `msg_goal_manager_${state.token}`);
  // What the watchdog records for a run that went silent, and what
  // interrupting a run on an unreachable device leaves behind.
  await db
    .update(agentOperations)
    .set({ status: 'abandoned' })
    .where(eq(agentOperations.id, op!.id));
  return graph.goal.id;
}

/**
 * Regression: `abandoned` was missing from the manager's ended-run statuses, so
 * a Goal whose planning run was abandoned paused as "unconfirmed", the owner's
 * confirm-exit refused it as still live, and binding it to another supervisor
 * was refused while the turn stayed in flight — with no way out.
 */
describe('GoalManagerService with an abandoned planning run', () => {
  it('settles the turn instead of pausing the Goal as unconfirmed', async () => {
    const id = await goalWithAbandonedTurn();
    expect((await service().tick(id)).outcome).toBe('advanced');
    expect((await model().findById(id))!.status).not.toBe('paused');
  });

  it('lets the owner confirm the turn has ended', async () => {
    const id = await goalWithAbandonedTurn();
    expect(await manager().confirmTurnExit(id)).toBe(true);
    expect((await model().findById(id))!.config!.managerState!.consumed).toBe(true);
  });

  it('does not try to interrupt the run again when stopping', async () => {
    const id = await goalWithAbandonedTurn();
    const interrupt = vi.spyOn(AiAgentService.prototype, 'interruptTask');
    await expect(manager().stop(await service().graph(id))).resolves.toBeUndefined();
    expect(interrupt).not.toHaveBeenCalled();
  });
});
