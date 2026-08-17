import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyResultRuntime } from '../verifyResult';

const mocks = vi.hoisted(() => ({
  finalizeVerifyRun: vi.fn(),
  findOperationById: vi.fn(),
  findRunByOperation: vi.fn(),
  recompute: vi.fn(),
  updateByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: mocks.findOperationById })),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    updateByCheckItem: mocks.updateByCheckItem,
  })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ findByOperation: mocks.findRunByOperation })),
}));

vi.mock('@/server/services/verify', () => ({
  finalizeVerifyRun: mocks.finalizeVerifyRun,
  VerifyStatusService: vi.fn(() => ({ recompute: mocks.recompute })),
}));

describe('verifyResultRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOperationById.mockResolvedValue({ parentOperationId: 'parent-op' });
    mocks.findRunByOperation.mockResolvedValue({ id: 'run-1' });
    mocks.updateByCheckItem.mockResolvedValue([{ id: 'result-1' }]);
  });

  it('rejects a checkItemId that does not belong to the verification run', async () => {
    mocks.updateByCheckItem.mockResolvedValue([]);

    const runtime = verifyResultRuntime.factory({
      operationId: 'verifier-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitVerifyResult({
      checkItemId: 'chekc-1',
      evidence: 'The delivery is complete.',
      reasoning: 'All requirements are covered.',
      verdict: 'passed',
    });

    expect(result).toEqual({
      content:
        'Check item "chekc-1" is not part of this verification run. Use the exact checkItemId from the verification prompt.',
      error: 'CHECK_ITEM_NOT_FOUND',
      success: false,
    });
    expect(mocks.updateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'chekc-1',
      expect.objectContaining({ status: 'passed', verdict: 'passed' }),
    );
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.finalizeVerifyRun).not.toHaveBeenCalled();
  });

  it('records the verdict when the checkItemId belongs to the verification run', async () => {
    const runtime = verifyResultRuntime.factory({
      operationId: 'verifier-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitVerifyResult({
      checkItemId: 'check-1',
      evidence: 'The delivery is complete.',
      reasoning: 'All requirements are covered.',
      verdict: 'passed',
    });

    expect(result).toEqual({
      content: 'Recorded verdict "passed" for the check. Verification complete.',
      success: true,
    });
    expect(mocks.updateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'check-1',
      expect.objectContaining({ status: 'passed', verdict: 'passed' }),
    );
    expect(mocks.recompute).toHaveBeenCalledWith('parent-op');
    expect(mocks.finalizeVerifyRun).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'parent-op',
      {},
      undefined,
    );
  });
});
