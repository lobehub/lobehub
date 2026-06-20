import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyRouter } from '@/server/routers/lambda/verify';

const modelMocks = vi.hoisted(() => ({
  findRunById: vi.fn(),
  findResultById: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    findById: modelMocks.findResultById,
    upsertByCheckItem: modelMocks.upsertByCheckItem,
  })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    findById: modelMocks.findRunById,
  })),
}));

vi.mock('@/server/services/verify', () => ({
  VerifyExecutorService: class VerifyExecutorService {},
  VerifyFeedbackService: class VerifyFeedbackService {},
  VerifyPlanGeneratorService: class VerifyPlanGeneratorService {},
}));

const createCaller = () => verifyRouter.createCaller({ userId: 'verify-router-test-user' } as any);

describe('verifyRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ingestResult', () => {
    it("rejects a run outside the caller's scope before upserting the result", async () => {
      modelMocks.findRunById.mockResolvedValueOnce(undefined);

      await expect(
        createCaller().ingestResult({
          checkItemId: 'shared-check',
          checkItemTitle: 'attacker update',
          status: 'passed',
          verdict: 'passed',
          verifyRunId: 'other-user-run',
        }),
      ).rejects.toThrow('Verification run not found');

      expect(modelMocks.findRunById).toHaveBeenCalledWith('other-user-run');
      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
    });
  });

  describe('uploadEvidence', () => {
    it('rejects evidence with both inline content and fileId', async () => {
      await expect(
        createCaller().uploadEvidence({
          checkResultId: 'result-1',
          content: 'inline payload',
          fileId: 'files-1',
          type: 'text',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });

    it('rejects evidence without inline content or fileId', async () => {
      await expect(
        createCaller().uploadEvidence({
          checkResultId: 'result-1',
          type: 'text',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });
  });
});
