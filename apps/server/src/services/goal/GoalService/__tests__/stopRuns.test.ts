// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import {
  acceptances,
  agentOperations,
  topics,
  verifyCheckResults,
  verifyRuns,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { TaskService } from '../../../task';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

const setup = async (title: string) => {
  const service = new GoalService(serverDB, userId);
  const graph = await service.create({ tasks: ['Build it'], title });
  const created = await service.tick(graph.goal.id);
  const taskId = created.taskId!;
  await new TaskModel(serverDB, userId).update(taskId, { status: 'running' });
  return { goalId: graph.goal.id, service, taskId };
};

/** A delivered Task: `running`, its topic `completed`, its acceptance being settled. */
const deliver = async (taskId: string, status: 'repairing' | 'verifying', suffix: string) => {
  const topicId = `tpc_stop_${suffix}`;
  await serverDB.insert(topics).values({ id: topicId, userId });
  const taskTopics = new TaskTopicModel(serverDB, userId);
  await taskTopics.add(taskId, topicId, { seq: 1 });
  await taskTopics.updateStatus(taskId, topicId, 'completed');
  const acceptance = (await new AcceptanceModel(serverDB, userId).findBySubject('task', taskId))!;
  await serverDB.update(acceptances).set({ status }).where(eq(acceptances.id, acceptance.id));
  return { acceptanceId: acceptance.id, topicId };
};

describe('GoalService.stopRuns', () => {
  it('interrupts the live run, holds the goal, and leaves the task for resume', async () => {
    const cancel = vi.spyOn(TaskService.prototype, 'cancelTopic').mockResolvedValue();
    const { goalId, service, taskId } = await setup('Stop a live run');
    await serverDB.insert(topics).values({ id: 'tpc_stop_live', userId });
    const taskTopics = new TaskTopicModel(serverDB, userId);
    await taskTopics.add(taskId, 'tpc_stop_live', { seq: 1 });
    await taskTopics.updateStatus(taskId, 'tpc_stop_live', 'running');

    const goal = await service.stopRuns(goalId);

    expect(cancel).toHaveBeenCalledWith('tpc_stop_live');
    expect(goal.status).toBe('paused');
    expect(goal.config?.pausedBy).toBe('user');
    expect((await new TaskModel(serverDB, userId).findById(taskId))?.status).toBe('backlog');
  });

  it('interrupts a repair running on a delivered task', async () => {
    const interrupt = vi
      .spyOn(AiAgentService.prototype, 'interruptTask')
      .mockResolvedValue({ success: true } as never);
    const { goalId, service, taskId } = await setup('Stop a repair');
    const { acceptanceId, topicId } = await deliver(taskId, 'repairing', 'repair');
    await serverDB.insert(agentOperations).values([
      { id: 'op_stop_repair', status: 'running', topicId, userId },
      { id: 'op_stop_finished', status: 'completed', topicId, userId },
    ] as never);
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId, plan: [], roundIndex: 1, status: 'repairing', userId } as never)
      .returning();
    await serverDB.insert(verifyCheckResults).values(
      [
        ['a', 'op_stop_repair'],
        ['b', 'op_stop_finished'],
      ].map(([checkItemId, repairOperationId]) => ({
        checkItemId,
        repairOperationId,
        status: 'failed' as const,
        userId,
        verifierType: 'agent' as const,
        verifyRunId: run.id,
      })),
    );

    const goal = await service.stopRuns(goalId);

    expect(goal.status).toBe('paused');
    expect(interrupt).toHaveBeenCalledOnce();
    expect(interrupt).toHaveBeenCalledWith({ operationId: 'op_stop_repair' });
  });

  it('says so when a repair cannot be stopped, and keeps the goal held', async () => {
    vi.spyOn(AiAgentService.prototype, 'interruptTask').mockResolvedValue({
      success: false,
    } as never);
    const { goalId, service, taskId } = await setup('Unstoppable repair');
    const { acceptanceId, topicId } = await deliver(taskId, 'repairing', 'refused');
    await serverDB
      .insert(agentOperations)
      .values({ id: 'op_stop_refused', status: 'running', topicId, userId } as never);
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId, plan: [], roundIndex: 1, status: 'repairing', userId } as never)
      .returning();
    await serverDB.insert(verifyCheckResults).values({
      checkItemId: 'a',
      repairOperationId: 'op_stop_refused',
      status: 'failed',
      userId,
      verifierType: 'agent',
      verifyRunId: run.id,
    });

    await expect(service.stopRuns(goalId)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    expect((await new GoalModel(serverDB, userId).findById(goalId))?.status).toBe('paused');
  });

  it('refuses a goal that has ended', async () => {
    const { goalId, service } = await setup('Already ended');
    await new GoalModel(serverDB, userId).updateStatus(goalId, 'canceled');

    await expect(service.stopRuns(goalId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('GoalService.close', () => {
  /**
   * Regression: a delivered Task reads `running` with no running topic, so the
   * close took it for a run still starting and refused for as long as the
   * delivery was being verified.
   */
  it('closes while a delivery is being verified', async () => {
    const { goalId, service, taskId } = await setup('Close during verification');
    await deliver(taskId, 'verifying', 'close');

    expect((await service.close(goalId, 'canceled')).status).toBe('canceled');
    // The verdict on what was delivered still lands on the task.
    expect((await new TaskModel(serverDB, userId).findById(taskId))?.status).toBe('running');
  });
});
