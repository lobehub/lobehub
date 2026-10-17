// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import {
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
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import * as scheduler from './scheduler';

const db = await getTestDB();
const userId = 'goal-task-model-user';
const agentId = 'goal-task-model-agent';
const otherAgentId = 'goal-task-model-other';
let seq = 0;
const service = () => new GoalService(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values([
    { id: agentId, model: 'gpt-4o-mini', provider: 'openai', slug: 'task-model-agent', userId },
    {
      id: otherAgentId,
      model: 'deepseek-chat',
      provider: 'deepseek',
      slug: 'task-model-other',
      userId,
    },
  ]);
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-task-model-${++seq}`;
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
    taskTopics,
    topics,
    tasks,
    agents,
    users,
  ])
    await db.delete(table);
});

const taskModelOf = async (taskId: string) => {
  const task = await new TaskModel(db, userId).findById(taskId);
  const config = (task?.config ?? {}) as { model?: string; provider?: string };
  return { assignee: task?.assigneeAgentId, model: config.model, provider: config.provider };
};

/** A goal whose first Task the coordinator has created. */
const goalWithTask = async () => {
  const graph = await service().create({ agentId, tasks: ['Only task'], title: 'Task model' });
  const created = await service().tick(graph.goal.id);
  return { goalId: graph.goal.id, taskId: created.taskId! };
};

describe('goal task model override', () => {
  it('pins the next coordinator-created Task to the override', async () => {
    const graph = await service().create({ agentId, tasks: ['Only task'], title: 'Pinned' });
    await service().setTaskModel(graph.goal.id, { model: 'gemini-3.8-flash', provider: 'google' });

    const created = await service().tick(graph.goal.id);

    expect(await taskModelOf(created.taskId!)).toMatchObject({
      model: 'gemini-3.8-flash',
      provider: 'google',
    });
  });

  it("switches unfinished Tasks, and back to the executor's own model on clear", async () => {
    const { goalId, taskId } = await goalWithTask();
    expect(await taskModelOf(taskId)).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });

    const picked = await service().setTaskModel(goalId, {
      model: 'gemini-3.8-flash',
      provider: 'google',
    });
    expect(picked.config).toMatchObject({ taskModel: 'gemini-3.8-flash', taskProvider: 'google' });
    expect(await taskModelOf(taskId)).toMatchObject({ model: 'gemini-3.8-flash' });

    const cleared = await service().setTaskModel(goalId, null);
    expect(cleared.config).not.toHaveProperty('taskModel');
    expect(await taskModelOf(taskId)).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });
  });

  it("drops the override on an executor change and moves Tasks to the new executor's model", async () => {
    const { goalId, taskId } = await goalWithTask();
    await service().setTaskModel(goalId, { model: 'gemini-3.8-flash', provider: 'google' });

    const handed = await service().setTaskAgent(goalId, otherAgentId);

    expect(handed.goal.config).not.toHaveProperty('taskModel');
    expect(await taskModelOf(taskId)).toEqual({
      assignee: otherAgentId,
      model: 'deepseek-chat',
      provider: 'deepseek',
    });
  });

  it('keeps the Task model when the goal agent changes under a dedicated executor', async () => {
    const graph = await service().create({ agentId, title: 'Dedicated' });
    await service().setTaskAgent(graph.goal.id, otherAgentId);
    await service().setTaskModel(graph.goal.id, { model: 'gemini-3.8-flash', provider: 'google' });

    // The executor stays the dedicated one, so its Task model is still valid.
    const handed = await service().setAgent(graph.goal.id, otherAgentId);

    expect(handed.goal.config).toMatchObject({ taskModel: 'gemini-3.8-flash' });
  });

  it("moves restarted Tasks to the new agent's model when restart hands the goal over", async () => {
    const { goalId, taskId } = await goalWithTask();
    await service().setTaskModel(goalId, { model: 'gemini-3.8-flash', provider: 'google' });

    const restarted = await service().restart(goalId, { agentId: otherAgentId });

    expect(restarted.goal.config).not.toHaveProperty('taskModel');
    expect(await taskModelOf(taskId)).toEqual({
      assignee: otherAgentId,
      model: 'deepseek-chat',
      provider: 'deepseek',
    });
  });
});
