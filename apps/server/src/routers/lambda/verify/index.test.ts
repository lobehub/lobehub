import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FileModelModule from '@/database/models/file';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { FileService } from '@/server/services/file';
import type * as VerifyServiceModule from '@/server/services/verify';

import { verifyRouter } from '.';

const modelMocks = vi.hoisted(() => ({
  createEvidence: vi.fn(),
  purgeVerifyRun: vi.fn(),
  createRun: vi.fn(),
  deleteResult: vi.fn(),
  deleteRun: vi.fn(),
  findFileById: vi.fn(),
  findRunByOperation: vi.fn(),
  findRunById: vi.fn(),
  findResultById: vi.fn(),
  generateCriteria: vi.fn(),
  generateGoalCriteria: vi.fn(),
  generateGoalPlan: vi.fn(),
  getFullFileUrl: vi.fn(),
  getServerDB: vi.fn(async () => ({})),
  listResultsByRun: vi.fn(),
  updateRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: modelMocks.getServerDB,
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return {
      delete: modelMocks.deleteResult,
      findById: modelMocks.findResultById,
      listByRun: modelMocks.listResultsByRun,
      upsertByCheckItem: modelMocks.upsertByCheckItem,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      create: modelMocks.createRun,
      delete: modelMocks.deleteRun,
      findByOperation: modelMocks.findRunByOperation,
      findById: modelMocks.findRunById,
      update: modelMocks.updateRun,
    };
  }),
}));

// Keep the real statics (the report bundle resolves file metadata through
// `FileModel.getFileById`); only the instance lookup the write paths use is stubbed.
vi.mock('@/database/models/file', async (importOriginal) => {
  const actual = await importOriginal<typeof FileModelModule>();
  class FileModel extends actual.FileModel {
    findById = modelMocks.findFileById as unknown as actual.FileModel['findById'];
  }
  return { ...actual, FileModel };
});

vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return {
      create: modelMocks.createEvidence,
    };
  }),
}));

vi.mock('@/server/services/verify', async (importOriginal) => ({
  ...(await importOriginal<typeof VerifyServiceModule>()),
  VerifyExecutorService: class VerifyExecutorService {},
  VerifyFeedbackService: class VerifyFeedbackService {},
  VerifyPlanGeneratorService: class VerifyPlanGeneratorService {
    generateCriteria = modelMocks.generateCriteria;
  },
  VerifyReporterService: class VerifyReporterService {},
}));

vi.mock('@/server/services/verify/acceptancePurge', () => ({
  purgeVerifyRun: modelMocks.purgeVerifyRun,
}));

vi.mock('@/server/services/goal/criteriaGenerator', () => ({
  GoalCriteriaGeneratorService: class GoalCriteriaGeneratorService {
    generate = modelMocks.generateGoalCriteria;
    generatePlan = modelMocks.generateGoalPlan;
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      getFullFileUrl: modelMocks.getFullFileUrl,
    };
  }),
}));

const createCaller = () => verifyRouter.createCaller({ userId: 'verify-router-test-user' } as any);
const createPublicCaller = () => verifyRouter.createCaller({} as any);

const selectRows = <T>(rows: T[]) => ({
  from: vi.fn(function () {
    return {
      where: vi.fn(function () {
        return {
          orderBy: vi.fn(async () => rows),
        };
      }),
    };
  }),
});

describe('verifyRouter', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.getServerDB.mockResolvedValue({});
    modelMocks.listResultsByRun.mockResolvedValue([]);
    modelMocks.findFileById.mockResolvedValue(undefined);
    vi.mocked(FileService).mockImplementation(function () {
      return {
        getFullFileUrl: modelMocks.getFullFileUrl,
      } as any;
    });
  });

  describe('getSkillBundle compatibility', () => {
    const snapshot = {
      content: '---\nname: acceptance\nmetadata:\n  version: "0.5.0"\n---\n# Acceptance',
      files: { 'scripts/capture.cjs': 'capture();', 'surfaces/cli.md': '# CLI' },
      identifier: 'acceptance',
      name: 'acceptance',
      source: {
        commit: 'a'.repeat(40),
        path: 'skills/acceptance',
        repository: 'lobehub/acceptance',
        ref: 'HEAD',
      },
      version: '0.5.0',
    };

    const mockSnapshot = () => {
      const files = { 'SKILL.md': snapshot.content, ...snapshot.files };
      const zip = zipSync(
        Object.fromEntries(
          Object.entries(files).map(([file, text]) => [
            `acceptance-${snapshot.source.commit}/skills/acceptance/${file}`,
            strToU8(text),
          ]),
        ),
      );
      return vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json({ sha: snapshot.source.commit }))
        .mockResolvedValueOnce(new Response(new Uint8Array(zip).buffer));
    };

    it.each(['acceptance', 'verify'])(
      'serves the default-branch source to legacy %s callers',
      async (identifier) => {
        mockSnapshot();
        expect(await createCaller().getSkillBundle({ identifier })).toEqual(snapshot);
      },
    );

    it.each(['acceptance', 'verify'])('serves %s without authentication', async (identifier) => {
      mockSnapshot();
      expect(await createPublicCaller().getSkillBundle({ identifier })).toEqual(snapshot);
    });

    it('rejects unknown identifiers without fetching upstream', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await expect(
        createPublicCaller().getSkillBundle({ identifier: 'unknown' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('keeps private verification reads and writes authenticated', async () => {
      await expect(
        createPublicCaller().getVerifyState({ operationId: 'operation-1' }),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      await expect(
        createPublicCaller().skipPlan({ operationId: 'operation-1' }),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(modelMocks.getServerDB).not.toHaveBeenCalled();
    });

    it('resolves an explicitly requested tag for newer clients', async () => {
      const fetchSpy = mockSnapshot();

      expect(
        await createPublicCaller().getSkillBundle({ identifier: 'acceptance', version: 'v0.5.0' }),
      ).toEqual({ ...snapshot, source: { ...snapshot.source, ref: 'v0.5.0' } });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/lobehub/acceptance/commits/v0.5.0',
        expect.any(Object),
      );
    });

    it('does not initialize reporting services to download a public skill', async () => {
      mockSnapshot();
      modelMocks.getServerDB.mockRejectedValueOnce(new Error('Reporting database unavailable'));

      expect(await createPublicCaller().getSkillBundle({ identifier: 'acceptance' })).toEqual(
        snapshot,
      );
      expect(modelMocks.getServerDB).not.toHaveBeenCalled();
      modelMocks.getServerDB.mockReset().mockResolvedValue({});
    });
  });

  describe('generateCriteria', () => {
    it('preserves InvalidProviderAPIKey without returning a session-expired HTTP status', async () => {
      modelMocks.generateCriteria.mockRejectedValueOnce({ errorType: 'InvalidProviderAPIKey' });

      const error = await createCaller()
        .generateCriteria({
          goal: 'Ship a responsive task board',
        })
        .catch((error) => error);

      expect(error).toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'InvalidProviderAPIKey',
      });
      expect(getHTTPStatusCodeFromError(error)).toBe(412);

      const infoSpy = vi.spyOn(console, 'info').mockImplementation(function () {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});
      createTRPCErrorLogger('/api/trpc')({
        error,
        path: 'verify.generateCriteria',
        type: 'mutation',
      });
      expect(infoSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not rewrite unrelated generation failures', async () => {
      const providerError = new Error('Provider timed out');
      modelMocks.generateCriteria.mockRejectedValueOnce(providerError);

      await expect(
        createCaller().generateCriteria({
          goal: 'Ship a responsive task board',
        }),
      ).rejects.toThrow('Provider timed out');
    });
  });

  describe('generateGoalCriteria', () => {
    it('does not accept a caller-selected model config', async () => {
      modelMocks.generateGoalCriteria.mockResolvedValueOnce([]);

      await createCaller().generateGoalCriteria({ goal: 'Ship a responsive task board' });

      expect(modelMocks.generateGoalCriteria).toHaveBeenCalledWith({
        goal: 'Ship a responsive task board',
      });
    });

    it('returns the generated plan from the versioned endpoint', async () => {
      const plan = {
        criteria: [{ title: 'Responsive task board is shipped' }],
        instruction: 'Ship a responsive task board.',
        title: 'Ship task board',
      };
      modelMocks.generateGoalPlan.mockResolvedValueOnce(plan);

      await expect(
        createCaller().generateGoalPlan({ goal: 'Ship a responsive task board' }),
      ).resolves.toEqual(plan);
    });
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

    it('persists structured visualization metadata with the check result', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });
      const metadata = {
        visualization: {
          datasets: [],
          schemaVersion: 1,
          views: [],
        },
      };

      await createCaller().ingestResult({
        checkItemId: 'check-1',
        metadata,
        verdict: 'passed',
        verifyRunId: 'run-1',
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ metadata }),
      );
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
      expect(modelMocks.purgeVerifyRun).not.toHaveBeenCalled();
    });

    it('purges a run the caller owns in its own scope and returns its id', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({
        id: 'run-1',
        userId: 'verify-router-test-user',
        workspaceId: 'ws-1',
      });

      const res = await createCaller().deleteRun({ verifyRunId: 'run-1' });

      expect(modelMocks.purgeVerifyRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'verify-router-test-user',
        'ws-1',
        'run-1',
      );
      expect(modelMocks.deleteRun).not.toHaveBeenCalled();
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

  describe('createRun — scenario-aware context contract', () => {
    it('preserves a non-coding scenario context as its own bag', async () => {
      modelMocks.createRun.mockResolvedValueOnce({ id: 'run-research' });

      await createCaller().createRun({
        context: {
          question: 'What changed in the EU AI Act enforcement in 2026?',
          sourceCount: 12,
          sources: [{ title: 'EUR-Lex', url: 'https://eur-lex.europa.eu' }],
        },
        scenario: 'research',
        title: 'research acceptance round',
      });

      // The bag must land as-is: an ordered union with the (all-optional,
      // stripping) coding schema would silently swallow these fields.
      expect(modelMocks.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            question: 'What changed in the EU AI Act enforcement in 2026?',
            sourceCount: 12,
            sources: [{ title: 'EUR-Lex', url: 'https://eur-lex.europa.eu' }],
          },
          scenario: 'research',
        }),
      );
    });

    it('still canonicalizes coding surfaces when scenario is absent (legacy contract)', async () => {
      modelMocks.createRun.mockResolvedValueOnce({ id: 'run-coding' });

      await createCaller().createRun({
        context: { branch: 'feat/x', surfaces: ['electron'] },
      });

      expect(modelMocks.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ context: { branch: 'feat/x', surfaces: ['desktop'] } }),
      );
    });

    it('rejects an unknown scenario before touching the database', async () => {
      await expect(
        createCaller().createRun({ scenario: 'poetry' as any, title: 'nope' }),
      ).rejects.toThrow();

      expect(modelMocks.createRun).not.toHaveBeenCalled();
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

  describe('getReportBundle', () => {
    // The real column is uuid-typed and the router guards malformed ids before
    // querying, so the fixture id must be a well-formed uuid.
    const RUN_UUID = '61a3475e-52b5-4a58-8ccc-e3ba43062c7a';

    it('reads a malformed run id as absent without ever querying', async () => {
      // Chat autolinkers glue trailing CJK punctuation onto shared links —
      // before the guard this aborted in Postgres (22P02) and surfaced as 500.
      const findFirst = vi.fn();
      modelMocks.getServerDB.mockResolvedValue({
        query: { verifyRuns: { findFirst } },
      });

      expect(
        await createPublicCaller().getReportBundle({ verifyRunId: `${RUN_UUID}（本轮` }),
      ).toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('hides a private run from visitors but not its owner', async () => {
      const run = {
        goal: 'Ship a working page',
        id: RUN_UUID,
        title: 'Run report',
        userId: 'owner-user',
        visibility: 'private',
        workspaceId: null,
      };
      const makeServerDB = () => ({
        query: {
          verifyReports: { findFirst: vi.fn(async () => null) },
          verifyRuns: { findFirst: vi.fn(async () => run) },
        },
        select: vi.fn().mockReturnValueOnce(selectRows([])),
      });

      // A visitor's denied read is indistinguishable from a missing run.
      modelMocks.getServerDB.mockResolvedValue(makeServerDB());
      expect(await createPublicCaller().getReportBundle({ verifyRunId: RUN_UUID })).toBeNull();

      // The owner still reads their own private report.
      modelMocks.getServerDB.mockResolvedValue(makeServerDB());
      const ownerCaller = verifyRouter.createCaller({ userId: 'owner-user' } as any);
      const bundle = await ownerCaller.getReportBundle({ verifyRunId: RUN_UUID });
      expect(bundle).toMatchObject({ isOwner: true, run: { id: RUN_UUID } });
    });

    it("keeps an only-me run from its workspace's members", async () => {
      const run = {
        goal: 'Ship a working page',
        id: RUN_UUID,
        title: 'Run report',
        userId: 'owner-user',
        visibility: 'owner',
        workspaceId: 'ws-1',
      };
      modelMocks.getServerDB.mockResolvedValue({
        query: {
          verifyReports: { findFirst: vi.fn(async () => null) },
          verifyRuns: { findFirst: vi.fn(async () => run) },
        },
        select: vi.fn().mockReturnValueOnce(selectRows([])),
      });

      const teammate = verifyRouter.createCaller({ userId: 'teammate-user' } as any);
      expect(await teammate.getReportBundle({ verifyRunId: RUN_UUID })).toBeNull();
    });

    it('reads a standalone report without a logged-in user', async () => {
      const run = {
        goal: 'Ship a working page',
        id: RUN_UUID,
        title: 'Run report',
        userId: 'owner-user',
        visibility: 'public',
        workspaceId: null,
      };
      const report = {
        id: 'report-1',
        totalChecks: 1,
        verdict: 'passed',
        verifyRunId: RUN_UUID,
      };
      const result = {
        checkItemId: 'check-1',
        checkItemIndex: 0,
        checkItemTitle: 'Page renders',
        id: 'result-1',
        required: true,
        status: 'passed',
        verdict: 'passed',
        verifyRunId: RUN_UUID,
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

      const bundle = await createPublicCaller().getReportBundle({ verifyRunId: RUN_UUID });

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
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});
      vi.mocked(FileService).mockImplementation(function () {
        throw new Error('S3 env missing');
      });

      const run = {
        goal: 'Ship a working page',
        id: RUN_UUID,
        title: 'Run report',
        userId: 'owner-user',
        visibility: 'public',
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
        verifyRunId: RUN_UUID,
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

      const bundle = await createPublicCaller().getReportBundle({ verifyRunId: RUN_UUID });

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
