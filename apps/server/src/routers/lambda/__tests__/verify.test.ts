import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyRouter } from '@/server/routers/lambda/verify';
import { FileService } from '@/server/services/file';

const modelMocks = vi.hoisted(() => ({
  createEvidence: vi.fn(),
  deleteResult: vi.fn(),
  deleteRun: vi.fn(),
  findRunByOperation: vi.fn(),
  findRunById: vi.fn(),
  findResultById: vi.fn(),
  getFullFileUrl: vi.fn(),
  getServerDB: vi.fn(async () => ({})),
  updateRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: modelMocks.getServerDB,
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    delete: modelMocks.deleteResult,
    findById: modelMocks.findResultById,
    upsertByCheckItem: modelMocks.upsertByCheckItem,
  })),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    delete: modelMocks.deleteRun,
    findByOperation: modelMocks.findRunByOperation,
    findById: modelMocks.findRunById,
    update: modelMocks.updateRun,
  })),
}));

vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(() => ({
    create: modelMocks.createEvidence,
  })),
}));

vi.mock('@/server/services/verify', () => ({
  VerifyExecutorService: class VerifyExecutorService {},
  VerifyFeedbackService: class VerifyFeedbackService {},
  VerifyPlanGeneratorService: class VerifyPlanGeneratorService {},
  VerifyReporterService: class VerifyReporterService {},
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

    it('records an infra failure as status `errored` with no verdict', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-err' });

      await createCaller().ingestResult({
        checkItemId: 'check-1',
        status: 'errored',
        toulmin: { limitation: 'Agent verifier failed to start.' },
        verifyRunId: 'run-1',
      });

      const written = modelMocks.upsertByCheckItem.mock.calls[0][0];
      expect(written).toMatchObject({ status: 'errored', verifyRunId: 'run-1' });
      expect(written.verdict).toBeUndefined();
    });

    it('rejects a result with neither a verdict nor an explicit status', async () => {
      await expect(
        createCaller().ingestResult({ checkItemId: 'check-1', verifyRunId: 'run-1' } as any),
      ).rejects.toThrow();
      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteRun', () => {
    it("rejects a run outside the caller's scope before deleting", async () => {
      modelMocks.findRunById.mockResolvedValueOnce(undefined);

      await expect(createCaller().deleteRun({ verifyRunId: 'other-user-run' })).rejects.toThrow(
        'Verification run not found',
      );

      expect(modelMocks.findRunById).toHaveBeenCalledWith('other-user-run');
      expect(modelMocks.deleteRun).not.toHaveBeenCalled();
    });

    it('deletes a run the caller owns and returns its id', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });

      const res = await createCaller().deleteRun({ verifyRunId: 'run-1' });

      expect(modelMocks.deleteRun).toHaveBeenCalledWith('run-1');
      expect(res).toEqual({ id: 'run-1', success: true });
    });
  });

  describe('updateRun', () => {
    it("rejects a run outside the caller's scope before updating", async () => {
      modelMocks.findRunById.mockResolvedValueOnce(undefined);

      await expect(
        createCaller().updateRun({
          value: { title: 'Renamed report' },
          verifyRunId: 'other-user-run',
        }),
      ).rejects.toThrow('Verification run not found');

      expect(modelMocks.findRunById).toHaveBeenCalledWith('other-user-run');
      expect(modelMocks.updateRun).not.toHaveBeenCalled();
    });

    it('renames a run the caller owns', async () => {
      const updatedRun = { id: 'run-1', title: 'Renamed report' };
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.updateRun.mockResolvedValueOnce(updatedRun);

      const res = await createCaller().updateRun({
        value: { title: 'Renamed report' },
        verifyRunId: 'run-1',
      });

      expect(modelMocks.updateRun).toHaveBeenCalledWith('run-1', { title: 'Renamed report' });
      expect(res).toEqual({ data: updatedRun, success: true });
    });

    it('refreshes the scope context in place on a re-ingest', async () => {
      const updatedRun = { id: 'run-1' };
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.updateRun.mockResolvedValueOnce(updatedRun);

      await createCaller().updateRun({
        value: {
          context: {
            branch: 'feat/x',
            commit: 'abc123',
            pullRequest: {
              number: 42,
              title: 'Ship x',
              url: 'https://github.com/lobehub/lobehub/pull/42',
            },
          },
          goal: 'ship x',
        },
        verifyRunId: 'run-1',
      });

      expect(modelMocks.updateRun).toHaveBeenCalledWith('run-1', {
        context: {
          branch: 'feat/x',
          commit: 'abc123',
          pullRequest: {
            number: 42,
            title: 'Ship x',
            url: 'https://github.com/lobehub/lobehub/pull/42',
          },
        },
        goal: 'ship x',
      });
    });

    it('rejects non-web pull request URLs before storing report context', async () => {
      await expect(
        createCaller().updateRun({
          value: {
            context: {
              pullRequest: {
                number: 42,
                title: 'Unsafe PR',
                url: 'javascript:alert(1)',
              },
            },
          },
          verifyRunId: 'run-1',
        }),
      ).rejects.toThrow();

      expect(modelMocks.findRunById).not.toHaveBeenCalled();
      expect(modelMocks.updateRun).not.toHaveBeenCalled();
    });
  });

  describe('deleteResult', () => {
    it("rejects a result outside the caller's scope before deleting", async () => {
      modelMocks.findResultById.mockResolvedValueOnce(undefined);

      await expect(createCaller().deleteResult({ id: 'other-user-result' })).rejects.toThrow(
        'Verification check result not found',
      );

      expect(modelMocks.findResultById).toHaveBeenCalledWith('other-user-result');
      expect(modelMocks.deleteResult).not.toHaveBeenCalled();
    });

    it('prunes a result the caller owns', async () => {
      modelMocks.findResultById.mockResolvedValueOnce({ id: 'result-1' });

      const res = await createCaller().deleteResult({ id: 'result-1' });

      expect(modelMocks.deleteResult).toHaveBeenCalledWith('result-1');
      expect(res).toEqual({ id: 'result-1', success: true });
    });
  });

  describe('submitCheckEvidence', () => {
    it("rejects a run outside the caller's scope before upserting", async () => {
      modelMocks.findRunById.mockResolvedValueOnce(undefined);

      await expect(
        createCaller().submitCheckEvidence({
          checkItemId: 'item-1',
          verdict: 'passed',
          verifyRunId: 'other-user-run',
        }),
      ).rejects.toThrow('Verification run not found');

      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
      expect(modelMocks.createEvidence).not.toHaveBeenCalled();
    });

    it('rejects an evidence item with both inline content and fileId', async () => {
      await expect(
        createCaller().submitCheckEvidence({
          checkItemId: 'item-1',
          evidence: [{ content: 'inline', fileId: 'files-1', type: 'text' }],
          verifyRunId: 'run-1',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });

    it('lazily upserts the check result and attaches evidence in one call', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verdict: 'passed' });
      modelMocks.createEvidence.mockResolvedValueOnce({ id: 'evidence-1' });

      const res = await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ fileId: 'files-1', type: 'screenshot' }],
        verdict: 'passed',
        verifyRunId: 'run-1',
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ checkItemId: 'item-1', verdict: 'passed', verifyRunId: 'run-1' }),
      );
      expect(modelMocks.createEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          checkResultId: 'result-1',
          fileId: 'files-1',
          type: 'screenshot',
        }),
      );
      expect(res).toEqual({
        checkResult: { id: 'result-1', verdict: 'passed' },
        evidence: [{ id: 'evidence-1' }],
      });
    });

    it('allows a verdict-only submit with no evidence', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verdict: 'failed' });

      const res = await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        verdict: 'failed',
        verifyRunId: 'run-1',
      });

      expect(modelMocks.createEvidence).not.toHaveBeenCalled();
      expect(res.evidence).toEqual([]);
    });

    it('requires either verifyRunId or operationId', async () => {
      await expect(
        createCaller().submitCheckEvidence({ checkItemId: 'item-1', verdict: 'passed' } as any),
      ).rejects.toThrow('Provide either `verifyRunId` or `operationId`.');
    });

    it('resolves the run from operationId when no verifyRunId is given', async () => {
      modelMocks.findRunByOperation.mockResolvedValueOnce({ id: 'run-9', plan: [] });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-9' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        operationId: 'op-1',
        verdict: 'passed',
      });

      expect(modelMocks.findRunByOperation).toHaveBeenCalledWith('op-1');
      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ verifyRunId: 'run-9' }),
      );
    });

    it('does NOT reset required/status on an evidence-only submit (no clobber)', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ content: 'note', type: 'text' }],
        verifyRunId: 'run-1',
      });

      const arg = modelMocks.upsertByCheckItem.mock.calls[0][0];
      // Both omitted → drizzle preserves the existing row's values / DB defaults.
      expect(arg.required).toBeUndefined();
      expect(arg.status).toBeUndefined();
    });

    it('hydrates required/verifierType/title from the run plan item', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({
        id: 'run-1',
        plan: [
          { id: 'item-1', index: 2, required: false, title: 'soft check', verifierType: 'llm' },
        ],
      });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ content: 'note', type: 'text' }],
        verifyRunId: 'run-1',
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({
          checkItemIndex: 2,
          checkItemTitle: 'soft check',
          required: false,
          verifierType: 'llm',
        }),
      );
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
            findFirst: vi.fn(async () => ({
              id: 'file-1',
              name: 'evidence.png',
              url: 'verify/evidence.png',
            })),
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
                fileName: 'evidence.png',
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
            findFirst: vi.fn(async () => ({
              id: 'file-1',
              name: 'evidence.png',
              url: 'verify/evidence.png',
            })),
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
                fileName: 'evidence.png',
                fileUrl: null,
              },
            ],
          },
        ],
        run,
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[verify:getReportBundle:resolveFileMeta]',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
