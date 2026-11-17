// @vitest-environment node
import type { GoalGraphNode } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { stopLaneRuns } from '../swarm';
import type { GoalServiceContext } from '../types';

const laneNodes = (taskIds: (string | undefined)[]) =>
  taskIds.map((taskId, index) => ({
    id: `node_lane_${index}`,
    taskId,
  })) as unknown as GoalGraphNode[];

interface CtxOptions {
  cancelTopic?: (topicId: string) => Promise<void>;
  runs?: { status: string; topicId?: string }[][];
  withdraw?: (taskId: string) => Promise<unknown>;
}

/**
 * `stopLaneRuns` only touches these three collaborators, so the whole wrap-up can
 * be exercised without a database.
 */
const fakeCtx = ({ runs = [], cancelTopic, withdraw }: CtxOptions) => {
  const findByTaskId = vi.fn();
  for (const batch of runs) findByTaskId.mockResolvedValueOnce(batch);
  findByTaskId.mockResolvedValue([]);

  const ctx = {
    taskModel: { updateStatusIfCurrent: vi.fn(withdraw ?? (async () => ({ id: 'task' }))) },
    taskService: { cancelTopic: vi.fn(cancelTopic ?? (async () => undefined)) },
    taskTopicModel: { findByTaskId },
  } as unknown as GoalServiceContext;

  return {
    ctx,
    cancelTopic: ctx.taskService.cancelTopic,
    findByTaskId,
    withdraw: ctx.taskModel.updateStatusIfCurrent,
  };
};

describe('stopLaneRuns', () => {
  it('stops a lane run that is still going', async () => {
    const fake = fakeCtx({ runs: [[{ status: 'running', topicId: 'tpc_lane_a' }]] });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual([]);

    expect(fake.cancelTopic).toHaveBeenCalledWith('tpc_lane_a');
    // The run is on record, so the Task stays as it is and nothing is withdrawn.
    expect(fake.withdraw).not.toHaveBeenCalled();
  });

  it('withdraws a claim that has not recorded its run yet', async () => {
    const fake = fakeCtx({ runs: [[]] });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual([]);

    expect(fake.withdraw).toHaveBeenCalledWith('task_a', 'running', 'backlog', { error: null });
    // Nothing to cancel: `runTask` interrupts whatever it started once it sees the claim gone.
    expect(fake.cancelTopic).not.toHaveBeenCalled();
  });

  it('stops a run that was recorded while the claim was being withdrawn', async () => {
    const fake = fakeCtx({
      runs: [[], [{ status: 'running', topicId: 'tpc_late' }]],
    });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual([]);

    expect(fake.withdraw).toHaveBeenCalled();
    expect(fake.cancelTopic).toHaveBeenCalledWith('tpc_late');
  });

  it('reports a run that refuses to stop so the wrap-up is retried', async () => {
    const fake = fakeCtx({
      cancelTopic: async () => {
        throw new Error('device did not confirm the interruption');
      },
      runs: [[{ status: 'running', topicId: 'tpc_lane_a' }]],
    });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual(['tpc_lane_a']);
  });

  it('reports a late run that refuses to stop after the withdrawal', async () => {
    const fake = fakeCtx({
      cancelTopic: async () => {
        throw new Error('device did not confirm the interruption');
      },
      runs: [[], [{ status: 'running', topicId: 'tpc_late' }]],
    });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual(['tpc_late']);
  });

  it('reports a claim that could not be withdrawn so the wrap-up is retried', async () => {
    const fake = fakeCtx({
      runs: [[]],
      withdraw: async () => {
        throw new Error('statement timeout while the Task row was locked');
      },
    });

    // The claim is still there, so a run can still be recorded against it.
    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual(['task_a']);
  });

  it('leaves a Task that is no longer running alone', async () => {
    const fake = fakeCtx({ runs: [[]], withdraw: async () => null });

    await expect(stopLaneRuns(fake.ctx, laneNodes(['task_a']))).resolves.toEqual([]);

    expect(fake.cancelTopic).not.toHaveBeenCalled();
  });

  it('walks every lane and skips the ones without a Task', async () => {
    const fake = fakeCtx({
      runs: [[], [{ status: 'running', topicId: 'tpc_b' }]],
    });

    await expect(stopLaneRuns(fake.ctx, laneNodes([undefined, 'task_b']))).resolves.toEqual([]);

    expect(fake.withdraw).toHaveBeenCalledTimes(1);
    expect(fake.withdraw).toHaveBeenCalledWith('task_b', 'running', 'backlog', { error: null });
    // Only the lane that was still starting is touched, and its race-recorded run is stopped.
    expect(fake.cancelTopic).toHaveBeenCalledWith('tpc_b');
  });
});
