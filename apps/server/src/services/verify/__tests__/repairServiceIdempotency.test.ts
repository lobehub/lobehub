// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyRepairService } from '../repairService';

const mocks = vi.hoisted(() => ({
  findVerifyMessage: vi.fn(),
  listOperationTree: vi.fn(),
  markRepairing: vi.fn(),
  messageUpdate: vi.fn(),
  resultsListByRun: vi.fn(),
  runFindByOperation: vi.fn(),
  settleFailedRepair: vi.fn(),
  updateByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {
      findVerifyMessageByOperationId: mocks.findVerifyMessage,
      update: mocks.messageUpdate,
    };
  }),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { listOperationTree: mocks.listOperationTree };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: mocks.runFindByOperation };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: mocks.resultsListByRun, updateByCheckItem: mocks.updateByCheckItem };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { markRepairing: mocks.markRepairing };
  }),
}));
vi.mock('../repairTerminal', () => ({ settleFailedRepair: mocks.settleFailedRepair }));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn(),
}));

const plan = [
  {
    id: 'item-1',
    index: 0,
    onFail: 'auto_repair',
    required: true,
    title: 'Works',
    verifierType: 'llm',
  },
];
const failedResult = (extra: Record<string, unknown> = {}) => ({
  checkItemId: 'item-1',
  status: 'failed',
  suggestion: 'fix it',
  verdict: 'failed',
  ...extra,
});

describe('VerifyRepairService.triggerAutoRepair idempotency', () => {
  const service = () => new VerifyRepairService({} as never, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findVerifyMessage.mockResolvedValue({ id: 'verify-msg' });
    mocks.listOperationTree.mockResolvedValue([{ id: 'op-1', parentOperationId: null }]);
    mocks.runFindByOperation.mockImplementation(async (operationId: string) =>
      operationId === 'op-1' ? { acceptanceId: 'acc-1', id: 'run-1', plan } : null,
    );
    mocks.resultsListByRun.mockResolvedValue([failedResult()]);
  });

  it('spawns and links a repair when none exists yet', async () => {
    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-1' });

    await expect(service().triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'repair-1',
    });

    expect(spawner).toHaveBeenCalledTimes(1);
    expect(mocks.updateByCheckItem).toHaveBeenCalledWith('run-1', 'item-1', {
      repairOperationId: 'repair-1',
    });
    expect(mocks.markRepairing).toHaveBeenCalledWith('op-1');
  });

  it('re-links the repair recorded on a failed result instead of spawning another', async () => {
    mocks.resultsListByRun.mockResolvedValue([failedResult({ repairOperationId: 'repair-1' })]);
    const spawner = vi.fn();

    await expect(service().triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'repair-1',
    });

    expect(spawner).not.toHaveBeenCalled();
    expect(mocks.markRepairing).toHaveBeenCalledWith('op-1');
    expect(mocks.settleFailedRepair).toHaveBeenCalledWith({}, 'user-1', 'repair-1', undefined);
  });

  it('adopts a spawned repair child whose link never persisted', async () => {
    // The repair child exists with its own confirmed round of the same
    // acceptance (written atomically with the child), but the link and the
    // `repairing` status failed — the finalizer is now being retried.
    mocks.listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'evidence-child', parentOperationId: 'op-1' },
      { id: 'repair-1', parentOperationId: 'op-1' },
    ]);
    mocks.runFindByOperation.mockImplementation(async (operationId: string) => {
      if (operationId === 'op-1') return { acceptanceId: 'acc-1', id: 'run-1', plan };
      if (operationId === 'repair-1')
        return { acceptanceId: 'acc-1', id: 'run-2', plan, planConfirmedAt: new Date() };
      return null; // the evidence child writes into the parent's run
    });
    const spawner = vi.fn();

    await expect(service().triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'repair-1',
    });

    expect(spawner).not.toHaveBeenCalled();
    expect(mocks.updateByCheckItem).toHaveBeenCalledWith('run-1', 'item-1', {
      repairOperationId: 'repair-1',
    });
    expect(mocks.markRepairing).toHaveBeenCalledWith('op-1');
  });

  it('does not mistake a child round of another acceptance for this run repair', async () => {
    mocks.listOperationTree.mockResolvedValue([
      { id: 'op-1', parentOperationId: null },
      { id: 'other-1', parentOperationId: 'op-1' },
    ]);
    mocks.runFindByOperation.mockImplementation(async (operationId: string) => {
      if (operationId === 'op-1') return { acceptanceId: 'acc-1', id: 'run-1', plan };
      return { acceptanceId: 'acc-2', id: 'run-x', plan, planConfirmedAt: new Date() };
    });
    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-2' });

    await expect(service().triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'repair-2',
    });
    expect(spawner).toHaveBeenCalledTimes(1);
  });
});
