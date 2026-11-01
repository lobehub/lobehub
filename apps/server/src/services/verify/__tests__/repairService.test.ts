// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { carriedRunPolicy, VerifyRepairService } from '../repairService';

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

  /**
   * Regression: rounds the Goal's Acceptance review sent back still read
   * `passed`, so they counted as a delivered acceptance and every later round's
   * auto-repair was declined as superseded. A one-artifact gap then cost a whole
   * new Task attempt each time.
   */
  it('still repairs after a passed round the Acceptance review sent back', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    m.rounds.mockResolvedValue([
      {
        id: 'round-2',
        metadata: { goalReview: { status: 'rejected' } },
        roundIndex: 2,
        status: 'passed',
        userDecision: null,
      },
      round,
    ]);
    const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' });

    expect(
      await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner),
    ).toEqual({ repairOperationId: 'repair-op' });
  });

  it('stops once another round passed the Acceptance review too', async () => {
    m.listResults.mockResolvedValue([gateFailure('gif-check')]);
    m.rounds.mockResolvedValue([
      {
        id: 'round-2',
        metadata: { goalReview: { status: 'passed' } },
        roundIndex: 2,
        status: 'passed',
        userDecision: null,
      },
      round,
    ]);
    const spawner = vi.fn();

    expect(
      await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner),
    ).toBeNull();
    expect(spawner).not.toHaveBeenCalled();
  });

  describe('a check the Acceptance review sent back', () => {
    const reviewed = {
      ...round,
      plan: [
        {
          ...item('landing'),
          title: 'Chapters land in the site',
          verifierConfig: {
            requiredEvidence: [
              { hint: '≥2 screenshots per chapter', type: 'screenshot' },
              { type: 'dom_snapshot' },
            ],
          },
        },
        item('optional-video', false),
      ],
      status: 'passed',
    };
    const rejection = [{ checkItemId: 'landing', feedback: 'ch09 lacks its second screenshot.' }];

    beforeEach(() => {
      m.run.mockResolvedValue(reviewed);
      m.rounds.mockResolvedValue([reviewed]);
      m.listResults.mockResolvedValue([
        { checkItemId: 'landing', status: 'passed', verdict: 'passed' },
      ]);
    });

    it('is repaired in the round although its verifier passed it', async () => {
      const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' });

      expect(
        await new VerifyRepairService({} as any, 'user').triggerAutoRepair(
          'op-3',
          spawner,
          rejection,
        ),
      ).toEqual({ repairOperationId: 'repair-op' });
      expect(spawner).toHaveBeenCalledWith(expect.objectContaining({ failedItemIds: ['landing'] }));
    });

    /**
     * Regression: told only what was missing, the builder re-submitted that one
     * artifact and dropped the rest — the screenshots one attempt, the DOM
     * snapshot the next — since the repaired check is judged from scratch.
     */
    it('asks for every required evidence of the check, not only the missing one', async () => {
      const spawner = vi.fn().mockResolvedValue({ repairOperationId: 'repair-op' });

      await new VerifyRepairService({} as any, 'user').triggerAutoRepair(
        'op-3',
        spawner,
        rejection,
      );

      const { instruction } = spawner.mock.calls[0][0];
      expect(instruction).toContain(
        'Chapters land in the site — the Acceptance review sent it back: ch09 lacks its second screenshot.',
      );
      expect(instruction).toContain(
        'Submit all of its required evidence to item landing, not only what is missing: screenshot (≥2 screenshots per chapter); dom_snapshot.',
      );
    });

    it('does not spend a repair on an optional check the review named', async () => {
      const spawner = vi.fn();

      expect(
        await new VerifyRepairService({} as any, 'user').triggerAutoRepair('op-3', spawner, [
          { checkItemId: 'optional-video', feedback: 'No video.' },
        ]),
      ).toBeNull();
      expect(spawner).not.toHaveBeenCalled();
    });
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

describe('carriedRunPolicy', () => {
  /**
   * A repair spawned after its source round was driven (the Acceptance review
   * path) inherited `taskDrivenAt`, so its own settle read "already drove" and
   * the Task never completed.
   */
  it('carries the policy but not how the source round settled', () => {
    expect(
      carriedRunPolicy({
        autoRepair: 'spawned',
        goalReview: { feedback: 'x', predictionIds: [], status: 'rejected' },
        maxRepairRounds: 2,
        taskDrivenAt: '2026-10-28T08:43:00.000Z',
      }),
    ).toEqual({ maxRepairRounds: 2 });
  });
});
