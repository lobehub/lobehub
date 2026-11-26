// @vitest-environment node
import {
  ACCEPTANCE_REVIEW_ERRORED_ERROR,
  ACCEPTANCE_REVIEW_RETRY_REQUESTED_ERROR,
  GOAL_RETRY_REVIEW_OPTION,
  VERIFICATION_UNJUDGEABLE_ERROR,
} from '@lobechat/const/goal';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { agentOperations, verifyRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from '../../../taskRunner';
import type * as SettleModule from '../../../verify/settle';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const { driveTaskFromVerify } = vi.hoisted(() => ({ driveTaskFromVerify: vi.fn() }));
vi.mock('../../../verify/settle', async (importOriginal) => ({
  ...(await importOriginal<typeof SettleModule>()),
  driveTaskFromVerify,
}));

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-service-test-user';

registerGoalServiceTestCleanup(serverDB, userId);

const CAUSE = 'Configure an available model on the Acceptance verifier agent and retry the review.';

const setup = async (title: string, error: string, reviewStatus = 'errored') => {
  const runTask = vi
    .spyOn(TaskRunnerService.prototype, 'runTask')
    .mockResolvedValue({ operationId: 'op-next', success: true } as never);
  const service = new GoalService(serverDB, userId);
  const taskModel = new TaskModel(serverDB, userId);
  const graph = await service.create({ tasks: ['Build it'], title });
  const created = await service.tick(graph.goal.id);
  const taskId = created.taskId!;
  runTask.mockClear();
  const operationId = `op_review_${taskId}`;
  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'completed', userId } as never);
  const acceptance = (await new AcceptanceModel(serverDB, userId).findBySubject('task', taskId))!;
  const [round] = await serverDB
    .insert(verifyRuns)
    .values({
      acceptanceId: acceptance.id,
      metadata: {
        goalReview: { feedback: CAUSE, predictionIds: [], status: reviewStatus },
        keep: 'policy',
        taskDrivenAt: new Date().toISOString(),
      },
      operationId,
      plan: [],
      roundIndex: 1,
      status: 'passed',
      userId,
    } as never)
    .returning();
  await taskModel.updateStatus(taskId, 'paused', { error });
  return { goalId: graph.goal.id, operationId, round, runTask, service, taskId, taskModel };
};

describe('a gate on an Acceptance review that reached no verdict', () => {
  beforeEach(() => driveTaskFromVerify.mockReset());

  it('says why the review failed and recommends running only the review', async () => {
    const { goalId, service } = await setup('Review outage', ACCEPTANCE_REVIEW_ERRORED_ERROR);

    await service.tick(goalId);

    const graph = await service.graph(goalId);
    expect(graph.decisions[0].options?.map((option) => option.id)).toEqual([
      GOAL_RETRY_REVIEW_OPTION,
      'retry',
      'retire',
    ]);
    expect(graph.decisions[0].recommendedOptionId).toBe(GOAL_RETRY_REVIEW_OPTION);
    expect(graph.nodes.find((node) => node.kind === 'decision')?.description).toBe(CAUSE);
  });

  it('tells the task activity what the review did with a passed round', async () => {
    const { operationId } = await setup('Run row', ACCEPTANCE_REVIEW_ERRORED_ERROR);

    const rounds = await new VerifyRunModel(serverDB, userId).findByOperations([operationId]);

    expect(rounds.get(operationId)?.goalReviewStatus).toBe('errored');
  });

  it('offers no re-run when the criterion itself cannot be judged', async () => {
    const { goalId, service } = await setup(
      'Unjudgeable',
      VERIFICATION_UNJUDGEABLE_ERROR,
      'unjudgeable',
    );

    await service.tick(goalId);

    const graph = await service.graph(goalId);
    expect(graph.decisions[0].options?.map((option) => option.id)).toEqual(['retry', 'retire']);
    expect(graph.nodes.find((node) => node.kind === 'decision')?.description).toBe(CAUSE);
  });

  it('re-reviews the same delivery without sending the builder back', async () => {
    const { goalId, operationId, round, runTask, service, taskId, taskModel } = await setup(
      'Run the review again',
      ACCEPTANCE_REVIEW_ERRORED_ERROR,
    );
    await service.tick(goalId);
    const [decision] = (await service.graph(goalId)).decisions;

    await service.decide(goalId, decision.id, GOAL_RETRY_REVIEW_OPTION);
    expect((await taskModel.findById(taskId))?.error).toBe(ACCEPTANCE_REVIEW_RETRY_REQUESTED_ERROR);

    await service.tick(goalId);

    expect(runTask).not.toHaveBeenCalled();
    expect(driveTaskFromVerify).toHaveBeenCalledOnce();
    expect(driveTaskFromVerify).toHaveBeenCalledWith(serverDB, userId, operationId, undefined);
    const task = await taskModel.findById(taskId);
    expect(task).toMatchObject({ error: null, status: 'running' });
    const [stored] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, round.id));
    // The drive is open again; what else the round recorded stays.
    expect(stored.metadata).toEqual({ keep: 'policy' });
  });

  it('holds the re-review while the goal is paused', async () => {
    const { goalId, service, taskId, taskModel } = await setup(
      'Paused before the re-review',
      ACCEPTANCE_REVIEW_ERRORED_ERROR,
    );
    await service.tick(goalId);
    const [decision] = (await service.graph(goalId)).decisions;
    await service.decide(goalId, decision.id, GOAL_RETRY_REVIEW_OPTION);
    await service.pause(goalId);

    await service.tick(goalId);

    expect(driveTaskFromVerify).not.toHaveBeenCalled();
    expect((await taskModel.findById(taskId))?.status).toBe('paused');
  });

  it('starts a new attempt when the reviewed round is gone', async () => {
    const { goalId, round, service, taskId, taskModel } = await setup(
      'Round removed',
      ACCEPTANCE_REVIEW_ERRORED_ERROR,
    );
    await service.tick(goalId);
    const [decision] = (await service.graph(goalId)).decisions;
    await service.decide(goalId, decision.id, GOAL_RETRY_REVIEW_OPTION);
    await serverDB.delete(verifyRuns).where(eq(verifyRuns.id, round.id));

    await service.tick(goalId);

    expect(driveTaskFromVerify).not.toHaveBeenCalled();
    expect((await taskModel.findById(taskId))?.status).toBe('backlog');
  });
});
