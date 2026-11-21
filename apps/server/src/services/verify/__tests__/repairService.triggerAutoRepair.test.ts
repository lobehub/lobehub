// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyRepairService } from '../repairService';

const m = vi.hoisted(() => ({
  messageUpdate: vi.fn(),
  findVerifyMessage: vi.fn(),
  runFindByOperation: vi.fn(),
  resultListByRun: vi.fn(),
  resultUpdateByCheckItem: vi.fn(),
  claimVerifying: vi.fn(),
  markRepairing: vi.fn(),
  claimRepairing: vi.fn(),
  recordAutoRepair: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: vi.fn() };
  }),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { findVerifyMessageByOperationId: m.findVerifyMessage, update: m.messageUpdate };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: m.resultListByRun, updateByCheckItem: m.resultUpdateByCheckItem };
  }),
}));
vi.mock('@/database/models/verifyRubric', () => ({
  VerifyRubricModel: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findByOperation: m.runFindByOperation,
      claimRepairing: m.claimRepairing,
      recordAutoRepair: m.recordAutoRepair,
      updateStatus: m.updateStatus,
    };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { claimVerifying: m.claimVerifying, markRepairing: m.markRepairing };
  }),
}));
vi.mock('./repairTerminal', () => ({
  settleFailedRepair: vi.fn(),
}));
vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('./acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/database/models/acceptance', () => ({}));
vi.mock('@/database/models/agent', () => ({}));
vi.mock('@/database/models/document', () => ({}));
vi.mock('@/database/models/goal', () => ({}));
vi.mock('@/database/models/project', () => ({}));
vi.mock('@/database/models/task', () => ({}));
vi.mock('@/database/models/taskTopic', () => ({}));
vi.mock('@/database/models/topic', () => ({}));
vi.mock('@/database/models/verifyEvidence', () => ({}));
vi.mock('@/database/models/verifyReport', () => ({}));
vi.mock('@/database/models/verifyReviewPrediction', () => ({}));
vi.mock('@/database/utils/softDelete', () => ({}));
vi.mock('@/server/workflows/expertiseRejection', () => ({}));
vi.mock('@/database/schemas/verify', () => ({}));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));
vi.mock('@/server/services/taskResultBridge', () => ({ TaskResultBridgeService: vi.fn() }));
vi.mock('./goalReview', () => ({ reviewGoalDelivery: vi.fn() }));
vi.mock('./goalReviewModelConfig', () => ({}));
vi.mock('@/database/repositories/aiInfra', () => ({}));
vi.mock('@/server/globalConfig', () => ({}));
vi.mock('@/server/modules/ModelRuntime', () => ({}));
vi.mock('@/server/services/goal/modelConfig', () => ({}));
vi.mock('@/database/models/file', () => ({}));
vi.mock('@/server/services/aiGeneration', () => ({}));
vi.mock('@/server/services/file', () => ({}));
vi.mock('./reporter', () => ({ VerifyReporterService: vi.fn() }));
vi.mock('./taskAcceptance', () => ({
  attachTaskRunToAcceptance: vi.fn(),
  resolveTaskAcceptance: vi.fn(),
}));

const db = {} as any;

const FAILED_AT = new Date('2026-08-10T00:00:00Z');

const failedRun = {
  id: 'run-1',
  status: 'failed',
  updatedAt: FAILED_AT,
  plan: [{ id: 'check-1', required: true, onFail: 'auto_repair' }],
};

describe('VerifyRepairService.triggerAutoRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.claimRepairing.mockResolvedValue(true);
    m.updateStatus.mockResolvedValue(undefined);
  });

  it('spawns a repair round when the run is settled and failures exist', async () => {
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue(null);
    m.markRepairing.mockResolvedValue(undefined);

    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'op-repair' });

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1', spawner);

    expect(result).toEqual({ repairOperationId: 'op-repair' });
    expect(spawner).toHaveBeenCalledOnce();
    // The claim lands BEFORE the spawn and covers the same run, pinned to the
    // exact row version read — not just its status.
    expect(m.claimRepairing).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', updatedAt: FAILED_AT }),
    );
    expect(m.recordAutoRepair).toHaveBeenCalledWith('run-1', 'spawned');
    expect(m.markRepairing).toHaveBeenCalledWith('op-1');
    expect(m.updateStatus).not.toHaveBeenCalled();
  });

  it('does not spawn a second repair round while one is already in flight', async () => {
    // Settlement re-entry guard: duplicate verifier submissions re-run
    // finalizeVerifyRun, which reaches triggerAutoRepair again. A run stamped
    // `repairing` owns settlement from here on — a second spawn against the
    // same failures would launch duplicate repair agents.
    m.runFindByOperation.mockResolvedValue({ ...failedRun, status: 'repairing' });

    const spawner = vi.fn();

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1', spawner);

    expect(result).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
    expect(m.claimRepairing).not.toHaveBeenCalled();
    expect(m.markRepairing).not.toHaveBeenCalled();
  });

  it('drops out when it loses the repair-round claim to a concurrent caller', async () => {
    // P1 regression: the read-only guard let two concurrent settlement calls
    // both observe a non-`repairing` run and both spawn. The atomic claim must
    // hand the round to exactly one of them.
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.claimRepairing.mockResolvedValue(false);

    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'op-repair' });

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1', spawner);

    expect(result).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
    expect(m.markRepairing).not.toHaveBeenCalled();
    expect(m.updateStatus).not.toHaveBeenCalled();
  });

  it('releases the claim when the spawner returns nothing, so a later attempt can re-enter', async () => {
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue(null);
    m.claimRepairing.mockResolvedValue(true);

    const spawner = vi.fn().mockResolvedValue(null);

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1', spawner);

    expect(result).toBeNull();
    expect(m.updateStatus).toHaveBeenCalledWith('run-1', 'failed');
    // The claim goes back first, then the failure stands as the round's verdict.
    expect(m.recordAutoRepair).toHaveBeenCalledWith('run-1', 'declined');
    expect(m.updateStatus.mock.invocationCallOrder[0]).toBeLessThan(
      m.recordAutoRepair.mock.invocationCallOrder[0],
    );
  });

  it('declines without taking the claim when no spawner is available', async () => {
    // Nothing could own a `repairing` stamp, so the run must keep its status.
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1');

    expect(result).toBeNull();
    expect(m.claimRepairing).not.toHaveBeenCalled();
    expect(m.recordAutoRepair).toHaveBeenCalledWith('run-1', 'declined');
  });

  it('releases the claim and rethrows when the spawner throws', async () => {
    // A throwing spawn must not strand the run in `repairing` — the release
    // keeps the claim re-enterable, and the original error propagates.
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue(null);
    m.claimRepairing.mockResolvedValue(true);
    m.updateStatus.mockRejectedValue(new Error('release write failed'));

    const spawner = vi.fn().mockRejectedValue(new Error('agent runtime exploded'));

    const service = new VerifyRepairService(db, 'user-1');
    await expect(service.triggerAutoRepair('op-1', spawner)).rejects.toThrow(
      'agent runtime exploded',
    );
    expect(m.updateStatus).toHaveBeenCalledWith('run-1', 'failed');
  });

  it('keeps the claim when post-spawn reconciliation throws', async () => {
    // P1 regression: the catch used to cover all post-spawn work too. If the
    // repair op was created successfully but linking results / markRepairing /
    // settleFailedRepair threw, the claim was rolled back to the old status
    // while the child stayed active — a settlement retry could then claim the
    // parent again and spawn a duplicate repair for the same failures.
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue(null);
    m.claimRepairing.mockResolvedValue(true);
    m.markRepairing.mockRejectedValue(new Error('recompute exploded'));

    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'op-repair' });

    const service = new VerifyRepairService(db, 'user-1');
    await expect(service.triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'op-repair',
    });
    // The claim is NOT released: no updateStatus back to the old status.
    expect(m.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps the claim when result linking throws after a successful spawn', async () => {
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue(null);
    m.claimRepairing.mockResolvedValue(true);
    m.resultUpdateByCheckItem.mockRejectedValue(new Error('link write failed'));

    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'op-repair' });

    const service = new VerifyRepairService(db, 'user-1');
    await expect(service.triggerAutoRepair('op-1', spawner)).resolves.toEqual({
      repairOperationId: 'op-repair',
    });
    expect(m.updateStatus).not.toHaveBeenCalled();
  });

  it('releases the claim when the verify-card write throws before the spawn', async () => {
    // Pre-spawn failure: no repair child exists, so nobody owns the claim —
    // it must be rolled back or the run is stuck in `repairing` forever.
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'failed', verdict: 'failed' },
    ]);
    m.findVerifyMessage.mockResolvedValue({ id: 'msg-1' });
    m.claimRepairing.mockResolvedValue(true);
    m.messageUpdate.mockRejectedValue(new Error('card write failed'));

    const spawner = vi.fn();

    const service = new VerifyRepairService(db, 'user-1');
    await expect(service.triggerAutoRepair('op-1', spawner)).rejects.toThrow('card write failed');
    expect(spawner).not.toHaveBeenCalled();
    expect(m.updateStatus).toHaveBeenCalledWith('run-1', 'failed');
  });

  it('returns null when there is nothing to repair', async () => {
    m.runFindByOperation.mockResolvedValue(failedRun);
    m.resultListByRun.mockResolvedValue([
      { checkItemId: 'check-1', status: 'passed', verdict: 'passed' },
    ]);

    const spawner = vi.fn();

    const service = new VerifyRepairService(db, 'user-1');
    const result = await service.triggerAutoRepair('op-1', spawner);

    expect(result).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
    expect(m.claimRepairing).not.toHaveBeenCalled();
  });
});
