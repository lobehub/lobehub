// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleFailedRepair } from '../repairTerminal';

const m = vi.hoisted(() => ({
  op: vi.fn(),
  run: vi.fn(),
  rounds: vi.fn(),
  claim: vi.fn(),
  write: vi.fn(),
  recompute: vi.fn(),
  ancestors: vi.fn(),
  drive: vi.fn(),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: m.op };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: m.run, listByAcceptance: m.rounds };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { upsertByCheckItem: m.write };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { claimVerifying: m.claim, recompute: m.recompute };
  }),
}));
vi.mock('../settle', () => ({
  driveTaskFromVerify: m.drive,
  recomputeRepairAncestors: m.ancestors,
}));
const db = {} as any;
const run = {
  id: 'repair-run',
  acceptanceId: 'acceptance',
  roundIndex: 2,
  status: 'planned',
  planConfirmedAt: new Date(),
  plan: [
    {
      id: 'check',
      index: 0,
      required: true,
      title: 'Report',
      verifierType: 'llm',
      verifierConfig: {},
    },
  ],
};

describe('settleFailedRepair', () => {
  beforeEach(() => {
    Object.values(m).forEach((mock) => mock.mockReset());
    m.op.mockResolvedValue({
      parentOperationId: 'parent',
      completionReason: 'error',
      error: { message: 'The model provider returned an empty completion.' },
    });
    m.run.mockImplementation(async (id) =>
      id === 'repair' ? run : { acceptanceId: 'acceptance' },
    );
    m.rounds.mockResolvedValue([run]);
    m.claim.mockResolvedValue(true);
  });

  it('turns an empty-completion repair into an infra error and settles its task and ancestors', async () => {
    expect(await settleFailedRepair(db, 'user', 'repair', 'ws')).toBe(true);
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({
        verifyRunId: 'repair-run',
        checkItemId: 'check',
        status: 'errored',
        verdict: null,
        toulmin: {
          limitation:
            'Repair error before verification: The model provider returned an empty completion.',
        },
      }),
    );
    expect(m.recompute).toHaveBeenCalledWith('repair');
    expect(m.ancestors).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'repair');
    expect(m.drive).toHaveBeenCalledWith(db, 'user', 'repair', 'ws');
  });

  it('recovers an interrupted repair too', async () => {
    m.op.mockResolvedValue({ parentOperationId: 'parent', completionReason: 'interrupted' });
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(true);
    expect(m.write.mock.calls[0][0].toulmin.limitation).toBe(
      'Repair interrupted before verification.',
    );
  });

  it.each(['done', undefined])(
    'leaves a successful or still-live operation alone (%s)',
    async (completionReason) => {
      m.op.mockResolvedValue({ parentOperationId: 'parent', completionReason });
      expect(await settleFailedRepair(db, 'user', 'repair')).toBe(false);
      expect(m.claim).not.toHaveBeenCalled();
    },
  );

  it('leaves evidence-only children without their own plan alone', async () => {
    m.run.mockResolvedValue(null);
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(false);
    expect(m.drive).not.toHaveBeenCalled();
  });

  it('does not overwrite a judging or settled round', async () => {
    m.run.mockResolvedValue({ ...run, status: 'passed' });
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(false);
    expect(m.write).not.toHaveBeenCalled();
  });

  it('does not act after losing the lease', async () => {
    m.claim.mockResolvedValue(false);
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(false);
    expect(m.write).not.toHaveBeenCalled();
    expect(m.drive).not.toHaveBeenCalled();
  });

  it('cleans up an old round without pausing a newer task attempt', async () => {
    m.rounds.mockResolvedValue([run, { id: 'new-run', roundIndex: 3 }]);
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(true);
    expect(m.recompute).toHaveBeenCalled();
    expect(m.ancestors).toHaveBeenCalled();
    expect(m.drive).not.toHaveBeenCalled();
  });

  it('collapses a late parent repairing stamp without rewriting already settled checks', async () => {
    m.run.mockResolvedValue({ ...run, status: 'errored' });
    expect(await settleFailedRepair(db, 'user', 'repair')).toBe(true);
    expect(m.write).not.toHaveBeenCalled();
    expect(m.ancestors).toHaveBeenCalled();
  });
});
