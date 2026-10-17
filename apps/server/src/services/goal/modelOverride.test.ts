// @vitest-environment node
import type { GoalConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import {
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  messages,
  topics,
  users,
} from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import * as scheduler from './scheduler';

const db = await getTestDB();
const userId = 'goal-model-override-user';
const agentId = 'goal-model-override-agent';
const otherAgentId = 'goal-model-override-other';
let seq = 0;
const service = () => new GoalService(db, userId);
const execAgent = () => vi.mocked(AiAgentService.prototype.execAgent);

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values([
    { id: agentId, slug: 'model-override-agent', userId },
    { id: otherAgentId, slug: 'model-override-other', userId },
  ]);
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-model-override-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await new AgentOperationModel(db, userId).recordStart({
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
    goalNodeDecisions,
    goalEdges,
    goalEvents,
    goalNodes,
    goals,
    agentOperations,
    messages,
    topics,
    agents,
    users,
  ])
    await db.delete(table);
});

/** A manager-mode goal whose first planning turn has been dispatched. */
const startManagedGoal = async (extraConfig: Partial<GoalConfig> = {}) => {
  const graph = await service().create({
    config: { manager: { maxTurns: 4 } },
    createdByAgentId: agentId,
    title: 'Managed goal',
  });
  // Supervision would take over the turn; see the same setup in manager.test.ts.
  await db
    .update(goals)
    .set({ config: { manager: { maxTurns: 4 }, ...extraConfig } })
    .where(eq(goals.id, graph.goal.id));
  expect((await service().tick(graph.goal.id)).outcome).toBe('waiting_external');
  return graph.goal.id;
};

describe('goal planning model override', () => {
  it('runs the planning turn on the override', async () => {
    await startManagedGoal({ model: 'deepseek-v4.1-flash', provider: 'deepseek' });

    expect(execAgent().mock.calls[0][0]).toMatchObject({
      agentId,
      model: 'deepseek-v4.1-flash',
      provider: 'deepseek',
    });
  });

  it("runs the planning turn on the agent's own model without one", async () => {
    await startManagedGoal();

    const params = execAgent().mock.calls[0][0];
    expect(params).not.toHaveProperty('model');
    expect(params).not.toHaveProperty('provider');
  });

  it('patches only the model keys, and clears them with null', async () => {
    const graph = await service().create({
      agentId,
      config: { maxConcurrentTasks: 2 },
      title: 'Model override',
    });

    const picked = await service().setModel(graph.goal.id, {
      model: 'deepseek-v4.1-flash',
      provider: 'deepseek',
    });
    expect(picked.config).toMatchObject({
      maxConcurrentTasks: 2,
      model: 'deepseek-v4.1-flash',
      provider: 'deepseek',
    });

    const cleared = await service().setModel(graph.goal.id, null);
    expect(cleared.config).not.toHaveProperty('model');
    expect(cleared.config).not.toHaveProperty('provider');
    expect(cleared.config?.maxConcurrentTasks).toBe(2);
  });

  it('drops the override when the goal changes agent, not when it is re-picked', async () => {
    const graph = await service().create({ agentId, title: 'Handover' });
    await service().setModel(graph.goal.id, { model: 'gpt-5', provider: 'openai' });

    const same = await service().setAgent(graph.goal.id, agentId);
    expect(same.goal.config?.model).toBe('gpt-5');

    const handed = await service().setAgent(graph.goal.id, otherAgentId);
    expect(handed.goal.agentId).toBe(otherAgentId);
    expect(handed.goal.config).not.toHaveProperty('model');
    expect(handed.goal.config).not.toHaveProperty('provider');
  });
});
