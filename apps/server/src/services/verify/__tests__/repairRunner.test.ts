// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepairRunner, maybeAutoRepair, VerifyRepairService } from '../repairService';

const { execAgent, findById, findByOperation, listByRun } = vi.hoisted(() => ({
  execAgent: vi.fn(),
  findById: vi.fn(),
  findByOperation: vi.fn(),
  listByRun: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return { execAgent };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun };
  }),
}));

const runnerParams = {
  agentId: 'builder-agent',
  db: {} as any,
  maxRepairRounds: 3,
  taskId: 'task-1',
  topicId: 'topic-1',
  userId: 'user-1',
};

const repairArgs = {
  failedItemIds: ['criterion-1'],
  instruction: 'fix it',
  operationId: 'work-op',
};

describe('createRepairRunner', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'repair-op', success: true });
    // The failed run is the first round: no parent operation.
    findById.mockReset().mockResolvedValue({ id: 'work-op', parentOperationId: null });
  });

  it('keeps the repaired run trigger on the repair run', async () => {
    const runner = createRepairRunner({ ...runnerParams, trigger: RequestTrigger.Task })!;

    await expect(runner(repairArgs)).resolves.toEqual({ repairOperationId: 'repair-op' });
    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentOperationId: 'work-op', trigger: RequestTrigger.Task }),
    );
  });

  it('falls back to the verify trigger when the repaired run has none', async () => {
    // Without a trigger, LobeHub-routed model calls throw RouteAttemptMissingContext
    // in development and record trigger=null in production spend logs.
    const runner = createRepairRunner({ ...runnerParams, trigger: null })!;

    await runner(repairArgs);
    expect(execAgent.mock.calls[0][0].trigger).toBe(RequestTrigger.Verify);
  });
});

describe('maybeAutoRepair', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'repair-op', success: true });
    findById.mockReset().mockResolvedValue({
      agentId: 'builder-agent',
      id: 'work-op',
      parentOperationId: null,
      taskId: 'task-1',
      topicId: 'topic-1',
      trigger: RequestTrigger.Task,
    });
    findByOperation.mockReset().mockResolvedValue({
      id: 'run-1',
      metadata: { maxRepairRounds: 3 },
      plan: [{ id: 'criterion-1', onFail: 'auto_repair', required: true }],
    });
    listByRun.mockReset().mockResolvedValue([{ checkItemId: 'criterion-1', status: 'failed' }]);
  });

  it('reads the trigger of the failed run for its repair', async () => {
    // Isolate the spawner wiring from the repair-decision rules.
    vi.spyOn(VerifyRepairService.prototype, 'triggerAutoRepair').mockImplementation(
      async (operationId, spawner) =>
        spawner!({ failedItemIds: ['criterion-1'], instruction: 'fix it', operationId }),
    );

    await maybeAutoRepair({} as any, 'user-1', 'work-op');

    expect(execAgent.mock.calls[0][0].trigger).toBe(RequestTrigger.Task);
  });
});
