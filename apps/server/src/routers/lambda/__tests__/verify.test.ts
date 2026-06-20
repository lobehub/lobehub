import { describe, expect, it, vi } from 'vitest';

import { verifyRouter } from '@/server/routers/lambda/verify';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/server/services/verify', () => ({
  VerifyExecutorService: class VerifyExecutorService {},
  VerifyFeedbackService: class VerifyFeedbackService {},
  VerifyPlanGeneratorService: class VerifyPlanGeneratorService {},
}));

const createCaller = () => verifyRouter.createCaller({ userId: 'verify-router-test-user' } as any);

describe('verifyRouter', () => {
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
