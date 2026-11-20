// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import { verifyCheckResults, verifyRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import { VERIFICATION_FAILED_ERROR } from '../../decideNextMove';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

const planItem = (id: string) => ({
  id,
  index: 0,
  onFail: 'auto_repair' as const,
  required: true,
  title: `Check ${id}`,
  verifierConfig: {},
  verifierType: 'agent' as const,
});

describe('GoalService recovery after a failed verification', () => {
  const setup = async (title: string) => {
    const runSpy = vi
      .spyOn(TaskRunnerService.prototype, 'runTask')
      .mockResolvedValue({ operationId: 'op-retry', success: true } as never);
    const service = new GoalService(serverDB, userId);
    const taskModel = new TaskModel(serverDB, userId);
    const graph = await service.create({
      config: { recovery: { maxAttemptsPerTask: 8 } },
      title,
      tasks: ['Measure input latency'],
    });
    const created = await service.tick(graph.goal.id);
    runSpy.mockClear();
    return { graph, runSpy, service, taskId: created.taskId!, taskModel };
  };

  /** One settled round per attempt, each leaving `failing` open. */
  const settleAttempts = async (taskId: string, failing: string[][]) => {
    // A Goal Task gets its Acceptance when the coordinator creates it.
    const acceptance = (await new AcceptanceModel(serverDB, userId).findBySubject('task', taskId))!;
    for (const [index, open] of failing.entries()) {
      const [run] = await serverDB
        .insert(verifyRuns)
        .values({
          acceptanceId: acceptance.id,
          metadata: { taskDrivenAt: new Date().toISOString() },
          plan: [planItem('input'), planItem('latency')],
          roundIndex: index + 1,
          status: 'failed',
          userId,
        } as never)
        .returning();
      await serverDB.insert(verifyCheckResults).values(
        ['input', 'latency'].map((checkItemId) => {
          const verdict = open.includes(checkItemId) ? ('failed' as const) : ('passed' as const);
          return {
            checkItemId,
            status: verdict,
            userId,
            verdict,
            verifierType: 'agent' as const,
            verifyRunId: run.id,
          };
        }),
      );
    }
  };

  const decisionReasons = async (service: GoalService, goalId: string) =>
    (await service.graph(goalId)).nodes
      .filter((node) => node.kind === 'decision')
      .map((node) => node.description);

  it('asks a person once two attempts fail verification the same way', async () => {
    const { graph, runSpy, service, taskId, taskModel } = await setup('Same failure twice');
    await settleAttempts(taskId, [['latency'], ['latency']]);
    await taskModel.update(taskId, { totalTopics: 2 });
    await taskModel.updateStatus(taskId, 'paused', { error: VERIFICATION_FAILED_ERROR });

    const gated = await service.tick(graph.goal.id);

    expect(runSpy).not.toHaveBeenCalled();
    expect(gated).toMatchObject({ outcome: 'waiting_human', taskId });
    const task = await taskModel.findById(taskId);
    expect(await decisionReasons(service, graph.goal.id)).toEqual([
      `Task ${task!.identifier} failed verification the same way 2 times in a row`,
    ]);
  });

  it('keeps retrying while each attempt fails on something else', async () => {
    const { graph, runSpy, service, taskId, taskModel } = await setup('Different failures');
    await settleAttempts(taskId, [['input'], ['latency']]);
    await taskModel.update(taskId, { totalTopics: 2 });
    await taskModel.updateStatus(taskId, 'paused', { error: VERIFICATION_FAILED_ERROR });

    await service.tick(graph.goal.id);

    expect(runSpy).toHaveBeenCalledOnce();
  });

  it('names why the next attempt could not start', async () => {
    const { graph, runSpy, service, taskId, taskModel } = await setup('Spawn refused');
    await taskModel.update(taskId, { totalTopics: 1 });
    await taskModel.updateStatus(taskId, 'paused', { error: VERIFICATION_FAILED_ERROR });
    runSpy.mockRejectedValue(
      new TRPCError({
        code: 'CONFLICT',
        message: 'Task already has a running topic (tpc_live). Cancel it first or use --continue.',
      }),
    );

    await service.tick(graph.goal.id);

    expect(await decisionReasons(service, graph.goal.id)).toEqual([
      'Automatic recovery could not start the next attempt: Task already has a running topic (tpc_live). Cancel it first or use --continue',
    ]);
  });

  it('keeps an internal spawn error out of the gate', async () => {
    const { graph, runSpy, service, taskId, taskModel } = await setup('Spawn crashed');
    await taskModel.update(taskId, { totalTopics: 1 });
    await taskModel.updateStatus(taskId, 'paused', { error: VERIFICATION_FAILED_ERROR });
    runSpy.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'));

    await service.tick(graph.goal.id);

    expect(await decisionReasons(service, graph.goal.id)).toEqual([
      'Automatic recovery could not start the next attempt',
    ]);
  });
});
