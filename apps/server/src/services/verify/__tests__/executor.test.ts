// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyExecutorService } from '../executor';

const mocks = vi.hoisted(() => ({
  evidenceListByRun: vi.fn(),
  resultCreateMany: vi.fn(),
  resultListByRun: vi.fn(),
  resultUpdateByCheckItem: vi.fn(),
  runEnsureForOperation: vi.fn(),
  statusMarkVerifying: vi.fn(),
  statusRecompute: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findById: vi.fn() })),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(() => ({ listByRun: mocks.evidenceListByRun })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    createMany: mocks.resultCreateMany,
    listByRun: mocks.resultListByRun,
    updateByCheckItem: mocks.resultUpdateByCheckItem,
  })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ ensureForOperation: mocks.runEnsureForOperation })),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(() => ({
    markVerifying: mocks.statusMarkVerifying,
    recompute: mocks.statusRecompute,
  })),
}));

describe('VerifyExecutorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evidenceListByRun.mockResolvedValue([]);
    mocks.resultCreateMany.mockResolvedValue(undefined);
    mocks.resultListByRun
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ checkItemId: 'word-count', status: 'pending' }]);
    mocks.resultUpdateByCheckItem.mockResolvedValue(undefined);
    mocks.statusMarkVerifying.mockResolvedValue(undefined);
    mocks.statusRecompute.mockResolvedValue('verifying');
  });

  it('runs a program criterion through the verifier-agent fallback', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'word-count',
          index: 0,
          required: true,
          title: '字数达标',
          verifierType: 'program',
        },
      ],
      planConfirmedAt: new Date(),
    });
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-1' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'story',
      goal: 'write a story',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-1',
      runVerifierAgent,
    });

    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItem: expect.objectContaining({ id: 'word-count', verifierType: 'program' }),
        operationId: 'builder-op-1',
      }),
    );
    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'word-count',
      expect.objectContaining({ status: 'running', verifierOperationId: 'verifier-op-1' }),
    );
  });
});
