// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiGenerationService } from '@/server/services/aiGeneration';

import { VerifyReporterService } from '../reporter';

const mocks = vi.hoisted(() => ({
  aiGenerateObject: vi.fn(),
  documentFindByIds: vi.fn(),
  evidenceListByRun: vi.fn(),
  reportUpsertByRun: vi.fn(),
  resultListByRun: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findByIds: mocks.documentFindByIds };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: mocks.resultListByRun };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByRun: mocks.evidenceListByRun };
  }),
}));
vi.mock('@/database/models/verifyReport', () => ({
  VerifyReportModel: vi.fn(function () {
    return { upsertByRun: mocks.reportUpsertByRun };
  }),
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject: mocks.aiGenerateObject };
  }),
}));
vi.mock('../responseLanguage', () => ({
  resolveVerifyResponseLanguage: vi.fn(async () => undefined),
}));

/**
 * Regression: the report narrative in a workspace billed the caller's personal budget because
 * the model call was built without the workspace id.
 */
describe('VerifyReporterService billing scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resultListByRun.mockResolvedValue([
      {
        checkItemId: 'a',
        checkItemTitle: 'A',
        confidence: 1,
        required: true,
        status: 'passed',
        verdict: 'passed',
      },
    ]);
    mocks.evidenceListByRun.mockResolvedValue([]);
    mocks.documentFindByIds.mockResolvedValue([]);
    mocks.aiGenerateObject.mockResolvedValue({ content: 'All good', summary: 'Passed' });
    mocks.reportUpsertByRun.mockImplementation(async (report) => report);
  });

  it('bills the report narrative to the workspace it runs in', async () => {
    const db = {} as never;

    await new VerifyReporterService(db, 'user-1', 'ws-1').generateReport({
      deliverable: 'done',
      goal: 'ship',
      modelConfig: { model: 'model', provider: 'provider' },
      verifyRunId: 'run-1',
    });

    expect(mocks.aiGenerateObject).toHaveBeenCalledTimes(1);
    expect(AiGenerationService).toHaveBeenCalledWith(db, 'user-1', 'ws-1');
  });
});
