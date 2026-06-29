import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleVerifierCheckFromTerminal } from '../verifierTerminal';

const {
  findRunByOperationMock,
  finalizeVerifyRunMock,
  listResultsByRunMock,
  recomputeMock,
  updateByCheckItemMock,
} = vi.hoisted(() => ({
  finalizeVerifyRunMock: vi.fn(),
  findRunByOperationMock: vi.fn(),
  listResultsByRunMock: vi.fn(),
  recomputeMock: vi.fn(),
  updateByCheckItemMock: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn().mockImplementation(() => ({
    findByOperation: findRunByOperationMock,
  })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn().mockImplementation(() => ({
    listByRun: listResultsByRunMock,
    updateByCheckItem: updateByCheckItemMock,
  })),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn().mockImplementation(() => ({ recompute: recomputeMock })),
}));
vi.mock('../settle', () => ({
  finalizeVerifyRun: finalizeVerifyRunMock,
}));

const db = {} as any;

describe('settleVerifierCheckFromTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRunByOperationMock.mockResolvedValue({ id: 'run-1' });
    listResultsByRunMock.mockResolvedValue([
      {
        checkItemId: 'check-1',
        status: 'running',
      },
    ]);
  });

  it('marks a still-running verifier result failed/uncertain and finalizes the parent run', async () => {
    await settleVerifierCheckFromTerminal(
      db,
      'u',
      {
        checkItemId: 'check-1',
        errorMessage: 'InvalidProviderAPIKey',
        parentOperationId: 'parent-op',
        reason: 'error',
        verifierOperationId: 'verifier-op',
      },
      'ws',
    );

    expect(updateByCheckItemMock).toHaveBeenCalledWith(
      'run-1',
      'check-1',
      expect.objectContaining({
        status: 'failed',
        toulmin: {
          limitation: 'Verifier failed before submitting a verdict: InvalidProviderAPIKey',
        },
        verdict: 'uncertain',
        verifierOperationId: 'verifier-op',
      }),
    );
    expect(recomputeMock).toHaveBeenCalledWith('parent-op');
    expect(finalizeVerifyRunMock).toHaveBeenCalledWith(db, 'u', 'parent-op', {}, 'ws');
  });

  it('does not overwrite a result already written by submitVerifyResult', async () => {
    listResultsByRunMock.mockResolvedValue([{ checkItemId: 'check-1', status: 'passed' }]);

    await settleVerifierCheckFromTerminal(db, 'u', {
      checkItemId: 'check-1',
      parentOperationId: 'parent-op',
      reason: 'done',
      verifierOperationId: 'verifier-op',
    });

    expect(updateByCheckItemMock).not.toHaveBeenCalled();
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(finalizeVerifyRunMock).not.toHaveBeenCalled();
  });
});
