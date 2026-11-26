// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { maybeAutoRepair, VerifyRepairService } from '../repairService';

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

describe('maybeAutoRepair', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'repair-op', success: true });
    // The failed run is a first-round chat turn: no parent operation.
    findById.mockReset().mockResolvedValue({
      agentId: 'builder-agent',
      id: 'work-op',
      parentOperationId: null,
      topicId: 'topic-1',
      trigger: RequestTrigger.Chat,
    });
    findByOperation.mockReset().mockResolvedValue({
      id: 'run-1',
      metadata: { maxRepairRounds: 3 },
      plan: [{ id: 'criterion-1', onFail: 'auto_repair', required: true }],
    });
    listByRun.mockReset().mockResolvedValue([{ checkItemId: 'criterion-1', status: 'failed' }]);
    // Isolate the spawner from the repair-decision rules.
    vi.spyOn(VerifyRepairService.prototype, 'triggerAutoRepair').mockImplementation(
      async (operationId, spawner) =>
        spawner!({ failedItemIds: ['criterion-1'], instruction: 'fix it', operationId }),
    );
  });

  it('runs the repair under the verify trigger, not the repaired run trigger', async () => {
    await expect(maybeAutoRepair({} as any, 'user-1', 'work-op')).resolves.toEqual({
      repairOperationId: 'repair-op',
    });

    // Without a trigger, LobeHub-routed model calls throw RouteAttemptMissingContext
    // in development. Inheriting `chat` would make the completion gate push the
    // user for this internal round.
    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentOperationId: 'work-op', trigger: RequestTrigger.Verify }),
    );
  });
});
