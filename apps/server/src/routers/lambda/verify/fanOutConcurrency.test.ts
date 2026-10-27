// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as VerifyServiceModule from '@/server/services/verify';

import { verifyRouter } from '.';

const mocks = vi.hoisted(() => ({
  createManyEvidence: vi.fn(),
  findCriteriaByIds: vi.fn(),
  findDocumentById: vi.fn(),
  findFileById: vi.fn(),
  findReportByRun: vi.fn(),
  findRunById: vi.fn(),
  findRunByOperation: vi.fn(),
  listResultsByRun: vi.fn(),
  queryRunPage: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/verifyCriterion', () => ({
  VerifyCriterionModel: vi.fn(function () {
    return { findByIds: mocks.findCriteriaByIds };
  }),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.findDocumentById };
  }),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { findById: mocks.findFileById };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findById: mocks.findRunById,
      findByOperation: mocks.findRunByOperation,
      queryPage: mocks.queryRunPage,
    };
  }),
}));

vi.mock('@/database/models/verifyReport', () => ({
  VerifyReportModel: vi.fn(function () {
    return { findByRun: mocks.findReportByRun };
  }),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { listByRun: mocks.listResultsByRun, upsertByCheckItem: mocks.upsertByCheckItem };
  }),
}));

vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { createMany: mocks.createManyEvidence };
  }),
}));

vi.mock('@/server/services/verify', async (importOriginal) => ({
  ...(await importOriginal<typeof VerifyServiceModule>()),
  VerifyExecutorService: class VerifyExecutorService {},
  VerifyFeedbackService: class VerifyFeedbackService {},
  VerifyPlanGeneratorService: class VerifyPlanGeneratorService {},
  VerifyReporterService: class VerifyReporterService {},
}));

vi.mock('@/server/services/goal/criteriaGenerator', () => ({
  GoalCriteriaGeneratorService: class GoalCriteriaGeneratorService {},
}));

const FAN_OUT_LIMIT = 5;
const ITEM_COUNT = 12;

/**
 * Wraps a lookup so it records the peak number of overlapping calls. Earlier
 * items resolve later, so a result list in input order proves order is kept.
 */
const trackInFlight = <A extends unknown[], R>(fn: (...args: A) => R) => {
  const state = { inFlight: 0, peak: 0 };
  let call = 0;
  const tracked = async (...args: A) => {
    const delay = ITEM_COUNT - call++;
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, delay));
    state.inFlight -= 1;
    return fn(...args);
  };
  return { state, tracked };
};

const ids = Array.from({ length: ITEM_COUNT }, (_, i) => `id-${i}`);
const createCaller = () => verifyRouter.createCaller({ userId: 'fan-out-test-user' } as any);

describe('verify router fan-outs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listResultsByRun.mockResolvedValue([]);
  });

  it('getCriteria loads linked documents in order with bounded concurrency', async () => {
    mocks.findCriteriaByIds.mockResolvedValue(ids.map((id) => ({ documentId: `doc-${id}`, id })));
    const { state, tracked } = trackInFlight((docId: string) => ({
      content: `content of ${docId}`,
      id: docId,
    }));
    mocks.findDocumentById.mockImplementation(tracked);

    const rows = await createCaller().getCriteria({ ids });

    expect(rows.map((row: any) => row.instruction)).toEqual(
      ids.map((id) => `content of doc-${id}`),
    );
    expect(mocks.findDocumentById).toHaveBeenCalledTimes(ITEM_COUNT);
    expect(state.peak).toBe(FAN_OUT_LIMIT);
  });

  it('submitCheckEvidence resolves files in order with bounded concurrency and inserts once', async () => {
    mocks.findRunById.mockResolvedValue({ id: 'run-1', plan: [] });
    mocks.upsertByCheckItem.mockResolvedValue({ id: 'result-1' });
    const { state, tracked } = trackInFlight((id: string) => ({
      fileType: 'image/png',
      id,
      name: `${id}.png`,
    }));
    mocks.findFileById.mockImplementation(tracked);
    mocks.createManyEvidence.mockImplementation(async (rows: { fileId: string }[]) =>
      rows.map((row) => ({ id: `evidence-${row.fileId}` })),
    );

    const res = await createCaller().submitCheckEvidence({
      checkItemId: 'item-1',
      evidence: ids.map((id) => ({ fileId: id, type: 'screenshot' as const })),
      verifyRunId: 'run-1',
    });

    expect(res.evidence).toEqual(ids.map((id) => ({ id: `evidence-${id}` })));
    expect(state.peak).toBe(FAN_OUT_LIMIT);
    expect(mocks.createManyEvidence).toHaveBeenCalledTimes(1);
  });

  it('listReportSummaries loads reports in order with bounded concurrency', async () => {
    mocks.queryRunPage.mockResolvedValue({
      items: ids.map((id) => ({ id, title: id })),
      nextCursor: undefined,
    });
    const { state, tracked } = trackInFlight((runId: string) => ({
      id: `report-${runId}`,
      summary: runId,
    }));
    mocks.findReportByRun.mockImplementation(tracked);

    const res = await createCaller().listReportSummaries({ limit: ITEM_COUNT });

    expect(res.items.map((item: any) => item.report?.id)).toEqual(ids.map((id) => `report-${id}`));
    expect(state.peak).toBe(FAN_OUT_LIMIT);
  });
});
