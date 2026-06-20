import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyRouter } from '@/server/routers/lambda/verify';
import { FileService } from '@/server/services/file';

const modelMocks = vi.hoisted(() => ({
  findRunById: vi.fn(),
  findResultById: vi.fn(),
  getFullFileUrl: vi.fn(),
  getServerDB: vi.fn(async () => ({})),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: modelMocks.getServerDB,
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

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    getFullFileUrl: modelMocks.getFullFileUrl,
  })),
}));

const createCaller = () => verifyRouter.createCaller({ userId: 'verify-router-test-user' } as any);
const createPublicCaller = () => verifyRouter.createCaller({} as any);

const selectRows = <T>(rows: T[]) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(async () => rows),
    })),
  })),
});

describe('verifyRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.getServerDB.mockResolvedValue({});
    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          getFullFileUrl: modelMocks.getFullFileUrl,
        }) as any,
    );
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

  describe('getReportBundle', () => {
    it('reads a standalone report without a logged-in user', async () => {
      const run = {
        goal: 'Ship a working page',
        id: 'run-1',
        title: 'Run report',
        userId: 'owner-user',
        workspaceId: null,
      };
      const report = {
        id: 'report-1',
        totalChecks: 1,
        verdict: 'passed',
        verifyRunId: 'run-1',
      };
      const result = {
        checkItemId: 'check-1',
        checkItemIndex: 0,
        checkItemTitle: 'Page renders',
        id: 'result-1',
        required: true,
        status: 'passed',
        verdict: 'passed',
        verifyRunId: 'run-1',
      };
      const evidence = {
        checkResultId: 'result-1',
        content: null,
        description: 'Homepage screenshot',
        fileId: 'file-1',
        id: 'evidence-1',
        type: 'screenshot',
      };
      const serverDB = {
        query: {
          files: {
            findFirst: vi.fn(async () => ({ id: 'file-1', url: 'verify/evidence.png' })),
          },
          verifyReports: {
            findFirst: vi.fn(async () => report),
          },
          verifyRuns: {
            findFirst: vi.fn(async () => run),
          },
        },
        select: vi
          .fn()
          .mockReturnValueOnce(selectRows([result]))
          .mockReturnValueOnce(selectRows([evidence])),
      };
      modelMocks.getServerDB.mockResolvedValue(serverDB);
      modelMocks.getFullFileUrl.mockResolvedValue('https://cdn.example.com/verify/evidence.png');

      const bundle = await createPublicCaller().getReportBundle({ verifyRunId: 'run-1' });

      expect(bundle).toMatchObject({
        report,
        results: [
          {
            checkItemId: 'check-1',
            evidence: [
              {
                fileId: 'file-1',
                fileUrl: 'https://cdn.example.com/verify/evidence.png',
              },
            ],
          },
        ],
        run,
      });
      expect(modelMocks.findRunById).not.toHaveBeenCalled();
    });

    it('keeps returning the bundle when file URL resolution is unavailable', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(FileService).mockImplementation(() => {
        throw new Error('S3 env missing');
      });

      const run = {
        goal: 'Ship a working page',
        id: 'run-1',
        title: 'Run report',
        userId: 'owner-user',
        workspaceId: null,
      };
      const result = {
        checkItemId: 'check-1',
        checkItemIndex: 0,
        checkItemTitle: 'Page renders',
        id: 'result-1',
        required: true,
        status: 'passed',
        verdict: 'passed',
        verifyRunId: 'run-1',
      };
      const evidence = {
        checkResultId: 'result-1',
        content: null,
        description: 'Homepage screenshot',
        fileId: 'file-1',
        id: 'evidence-1',
        type: 'screenshot',
      };
      const serverDB = {
        query: {
          files: {
            findFirst: vi.fn(async () => ({ id: 'file-1', url: 'verify/evidence.png' })),
          },
          verifyReports: {
            findFirst: vi.fn(async () => null),
          },
          verifyRuns: {
            findFirst: vi.fn(async () => run),
          },
        },
        select: vi
          .fn()
          .mockReturnValueOnce(selectRows([result]))
          .mockReturnValueOnce(selectRows([evidence])),
      };
      modelMocks.getServerDB.mockResolvedValue(serverDB);

      const bundle = await createPublicCaller().getReportBundle({ verifyRunId: 'run-1' });

      expect(bundle).toMatchObject({
        results: [
          {
            evidence: [
              {
                fileId: 'file-1',
                fileUrl: null,
              },
            ],
          },
        ],
        run,
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[verify:getReportBundle:resolveFileUrl]',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
