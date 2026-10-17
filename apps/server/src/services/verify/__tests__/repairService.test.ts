// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyRepairService } from '../repairService';

const m = vi.hoisted(() => ({
  findVerifyMessage: vi.fn(),
  listResults: vi.fn(),
  markRepairing: vi.fn(),
  recordAutoRepair: vi.fn(),
  rounds: vi.fn(),
  run: vi.fn(),
  settleFailedRepair: vi.fn(),
  updateMessage: vi.fn(),
  updateResult: vi.fn(),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { findVerifyMessageByOperationId: m.findVerifyMessage, update: m.updateMessage };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findByOperation: m.run,
      listByAcceptance: m.rounds,
      recordAutoRepair: m.recordAutoRepair,
    };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: m.listResults, updateByCheckItem: m.updateResult };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { markRepairing: m.markRepairing };
  }),
}));
vi.mock('../repairTerminal', () => ({ settleFailedRepair: m.settleFailedRepair }));

const item = (id: string, required = true) => ({
  id,
  index: 0,
  onFail: 'auto_repair',
  required,
  title: id,
  verifierConfig: {},
  verifierType: 'agent',
});

const round = {
  acceptanceId: 'acceptance',
  id: 'round-3',
  plan: [item('gif-check'), item('optional-video', false)],
  roundIndex: 3,
  status: 'failed',
};

const gateFailure = (checkItemId: string) => ({
  checkItemId,
  status: 'failed',
  suggestion: 'Capture and upload the missing evidence',
  verdict: 'uncertain',
});

describe('VerifyRepairService.triggerAutoRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.run.mockResolvedValue(round);
    m.rounds.mockResolvedValue([round]);
    m.findVerifyMessage.mockResolvedValue(undefined);
  });

  it('repairs a failed required check', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' });

    const spawned = await new VerifyRepairService({} as any, 'user').triggerAutoRepair(
      'op-3',
      spawner,
    );

    expect(spawned).toEqual({ repairOperationId: 'repair-op' });
    expect(spawner).toHaveBeenCalledWith(expect.objectContaining({ failedItemIds: ['gif-check'] }));
  });

  it('does not spend a repair round on an optional check', async () => {
    m.listResults.mockResolvedValue([
      { checkItemId: 'gif-check', status: 'passed', verdict: 'passed' },
      gateFailure('optional-video'),
    ]);
    const spawner = vi.fn();

    const spawned = await new VerifyRepairService({} as any, 'user').triggerAutoRepair(
      'op-3',
      spawner,
    );

    expect(spawned).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
  });

  it('stops a stale chain once another round of the acceptance passed', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    m.rounds.mockResolvedValue([
      { id: 'round-2', roundIndex: 2, status: 'passed', userDecision: null },
      round,
    ]);
    const spawner = vi.fn();

    expect(
      await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner),
    ).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
  });

  it('stops a stale chain once a later round exists', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    m.rounds.mockResolvedValue([round, { id: 'round-4', roundIndex: 4, status: 'verifying' }]);
    const spawner = vi.fn();

    expect(
      await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner),
    ).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
  });

  it('still repairs after a passed round the user rejected', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    m.rounds.mockResolvedValue([
      { id: 'round-2', roundIndex: 2, status: 'passed', userDecision: 'reject' },
      round,
    ]);
    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' });

    expect(
      await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner),
    ).toEqual({ repairOperationId: 'repair-op' });
  });

  describe('records the auto-repair decision', () => {
    const trigger = (spawner?: any) =>
      new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner);

    beforeEach(() => m.listResults.mockResolvedValue([gateFailure('gif-check')]));

    it('marks a spawned repair', async () => {
      await trigger(vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' }));
      expect(m.recordAutoRepair).toHaveBeenCalledWith('round-3', 'spawned');
    });

    it('declines when the spawner returns nothing (repair cap reached or spawn failed)', async () => {
      expect(await trigger(vi.fn().mockResolvedValue(null))).toBeNull();
      expect(m.recordAutoRepair).toHaveBeenCalledWith('round-3', 'declined');
    });

    it('declines without a spawner', async () => {
      expect(await trigger()).toBeNull();
      expect(m.recordAutoRepair).toHaveBeenCalledWith('round-3', 'declined');
    });

    it('declines a superseded round', async () => {
      m.rounds.mockResolvedValue([round, { id: 'round-4', roundIndex: 4, status: 'verifying' }]);
      expect(await trigger(vi.fn())).toBeNull();
      expect(m.recordAutoRepair).toHaveBeenCalledWith('round-3', 'declined');
    });

    it('records nothing when no auto-repair check failed', async () => {
      m.listResults.mockResolvedValue([{ checkItemId: 'gif-check', status: 'passed' }]);
      await trigger(vi.fn());
      expect(m.recordAutoRepair).not.toHaveBeenCalled();
    });
  });
});
