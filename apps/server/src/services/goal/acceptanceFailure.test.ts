// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AcceptanceModel } from '@/database/models/acceptance';
import type { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import type { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { GoalAcceptanceFailureService } from './acceptanceFailure';

const reads = vi.hoisted(() => ({
  acceptance: vi.fn(),
  runs: vi.fn(),
  results: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: class {
    findBySubject = reads.acceptance;
  },
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: class {
    listByAcceptance = reads.runs;
  },
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: class {
    listByRun = reads.results;
  },
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: class {
    listByRun = reads.evidence;
  },
}));
const db = {} as LobeChatDatabase;
const service = () => new GoalAcceptanceFailureService(db, 'owner');
const fixtures = () => {
  reads.acceptance.mockResolvedValue({
    id: 'acceptance',
  } as Awaited<ReturnType<AcceptanceModel['findBySubject']>>);
  reads.runs.mockResolvedValue([
    { id: 'old-run', operationId: 'old-operation' },
    {
      id: 'current-run',
      operationId: 'current-operation',
      plan: [
        {
          id: 'failed-check',
          title: 'Immutable criterion title',
          sourceCriterionId: 'source-criterion',
        },
      ],
    },
  ] as Awaited<ReturnType<VerifyRunModel['listByAcceptance']>>);
  reads.results.mockResolvedValue([
    {
      id: 'failed-result',
      checkItemId: 'failed-check',
      sourceCriterionId: null,
      required: true,
      status: 'failed',
      verdict: 'failed',
      toulmin: {
        reasoning: 'Independent evidence shows missing correction',
        evidence: 'Observed old output',
      },
      suggestion: 'Recapture changed output',
      verifierOperationId: 'independent-verifier',
    },
    {
      id: 'passed-result',
      checkItemId: 'passed-check',
      status: 'passed',
      verdict: 'passed',
      required: true,
    },
  ] as Awaited<ReturnType<VerifyCheckResultModel['listByRun']>>);
  reads.evidence.mockResolvedValue([
    {
      id: 'failed-proof',
      checkResultId: 'failed-result',
      checkItemId: 'failed-check',
      type: 'text',
      content: 'Captured old output',
      documentId: 'evidence-document',
      fileId: 'evidence-file',
    },
    {
      id: 'unrelated-proof',
      checkResultId: 'passed-result',
      checkItemId: 'passed-check',
      type: 'text',
      content: 'Unrelated passed observation',
    },
  ] as Awaited<ReturnType<VerifyEvidenceModel['listByRun']>>);
};
afterEach(() => vi.clearAllMocks());

describe('Goal failed acceptance clauses', () => {
  it('freezes the exact operation criterion verdict and its own evidence provenance', async () => {
    fixtures();
    const clauses = await service().capture('acceptance-task', 'current-operation');
    expect(clauses).toEqual([
      {
        checkItemId: 'failed-check',
        criterionId: 'source-criterion',
        evidence: [
          {
            id: 'failed-proof',
            type: 'text',
            content: 'Captured old output',
            documentId: 'evidence-document',
            fileId: 'evidence-file',
            description: undefined,
          },
        ],
        narrative: {
          reasoning: 'Independent evidence shows missing correction',
          evidence: 'Observed old output',
        },
        reason: 'Independent evidence shows missing correction',
        required: true,
        status: 'failed',
        suggestion: 'Recapture changed output',
        title: 'Immutable criterion title',
        verdict: 'failed',
        verifierOperationId: 'independent-verifier',
        verifyRunId: 'current-run',
      },
    ]);
    expect(reads.results).toHaveBeenCalledWith('current-run');
  });

  it('does not substitute another operation when the bound run is absent', async () => {
    fixtures();
    expect(await service().capture('acceptance-task', 'stale-operation')).toEqual([]);
    expect(reads.results).not.toHaveBeenCalled();
  });

  it('does not infer legacy verdict clauses without a confirmed operation identity', async () => {
    expect(await service().capture('legacy-task')).toEqual([]);
  });
});
