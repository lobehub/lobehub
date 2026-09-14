// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import type * as AcceptanceServiceModule from '../acceptanceService';
import { reviewGoalDelivery } from '../goalReview';

const mocks = vi.hoisted(() => ({
  goal: vi.fn(),
  run: vi.fn(),
  metadata: vi.fn(),
  acceptance: vi.fn(),
  rounds: vi.fn(),
  predict: vi.fn(),
  reviewModel: vi.fn(),
}));
vi.mock('../goalReviewModelConfig', () => ({ resolveGoalReviewModelConfig: mocks.reviewModel }));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByCheckResult: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByGraphTask: mocks.goal };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { findByOperation: mocks.run, setMetadata: mocks.metadata };
  }),
}));
vi.mock('../acceptanceService', async (original) => ({
  ...(await original<typeof AcceptanceServiceModule>()),
  AcceptanceService: vi.fn(function () {
    return {
      acceptanceModel: { findById: mocks.acceptance },
      loadRounds: mocks.rounds,
    };
  }),
}));
vi.mock('../reviewPredictor', () => ({
  REVIEW_PREDICT_CONCURRENCY: 4,
  VerifyReviewPredictorService: vi.fn(function () {
    return { predict: mocks.predict };
  }),
}));
const db = {} as LobeChatDatabase;
const check = {
  id: 'c1',
  title: 'Document contents',
  required: true,
  verifierType: 'agent',
  verifierConfig: {},
  index: 0,
};
const result = {
  id: 'result1',
  checkItemId: 'c1',
  verifyRunId: 'r1',
  status: 'passed',
  verdict: 'passed',
  required: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reviewModel.mockResolvedValue({
    model: 'configured-model',
    provider: 'configured-provider',
  });
  mocks.goal.mockResolvedValue({ id: 'goal1' });
  mocks.run.mockResolvedValue({
    id: 'r1',
    acceptanceId: 'a1',
    metadata: { taskDrivenAt: 'claimed', maxRepairRounds: 2 },
  });
  mocks.acceptance.mockResolvedValue({ id: 'a1', requirement: 'Deliver an editable document' });
  mocks.rounds.mockResolvedValue({
    runs: [{ id: 'r1', roundIndex: 1, plan: [check] }],
    results: [result],
  });
  mocks.predict.mockResolvedValue({ id: 'p1', status: 'judged', action: 'accept' });
});

describe('Goal automatic Acceptance review', () => {
  it('does not automatically review ordinary tasks', async () => {
    mocks.goal.mockResolvedValue(null);
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toBeUndefined();
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it('records an AI acceptance without writing a human decision', async () => {
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({
      status: 'passed',
      predictionIds: ['p1'],
    });
    expect(mocks.metadata).toHaveBeenCalledWith('r1', {
      taskDrivenAt: 'claimed',
      maxRepairRounds: 2,
      goalReview: { status: 'passed', predictionIds: ['p1'], feedback: '' },
    });
    expect(mocks.predict).toHaveBeenCalledWith(
      expect.objectContaining({ includeTextEvidence: true, checkResultId: 'result1' }),
    );
  });

  /**
   * Regression: an "I cannot decide this from evidence" verdict was folded into
   * `rejected`, which told the builder to fix nothing and sent the Task round
   * again against the same unprovable criterion until the attempt budget ran out.
   */
  it('keeps an undecidable criterion out of the rejected bucket', async () => {
    mocks.predict.mockResolvedValue({
      id: 'p1',
      status: 'judged',
      action: 'unjudgeable',
      comment: 'The check asks the reviewer to rerun the scripts; a reader cannot do that.',
    });
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({
      status: 'unjudgeable',
      feedback:
        'Document contents: The check asks the reviewer to rerun the scripts; a reader cannot do that.',
    });
  });

  it('still reports a rejection when one check is short and another is undecidable', async () => {
    const second = { ...check, id: 'c2', index: 1, title: 'Chart rendered' };
    mocks.rounds.mockResolvedValue({
      runs: [{ id: 'r1', roundIndex: 1, plan: [check, second] }],
      results: [result, { ...result, id: 'result2', checkItemId: 'c2' }],
    });
    mocks.predict.mockImplementation(async ({ checkResultId }: { checkResultId: string }) =>
      checkResultId === 'result1'
        ? { id: 'p1', status: 'judged', action: 'unjudgeable', comment: 'Needs execution.' }
        : { id: 'p2', status: 'judged', action: 'reject', comment: 'The chart is blank.' },
    );
    // A genuinely short check makes another attempt worth paying for, so the
    // blocking outcome wins regardless of which check settled first.
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({ status: 'rejected' });
  });

  it('turns a rejection proposal into actionable feedback even when Verify passed', async () => {
    mocks.predict.mockResolvedValue({
      id: 'p1',
      status: 'judged',
      action: 'reject',
      comment: 'The exported file is missing the table.',
    });
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({
      status: 'rejected',
      feedback: 'Document contents: The exported file is missing the table.',
    });
  });

  it('reviews supplementary checks across rounds, not only the bound run', async () => {
    mocks.rounds.mockResolvedValue({
      runs: [
        { id: 'r1', roundIndex: 1, plan: [check] },
        { id: 'r2', roundIndex: 2, plan: [{ ...check, id: 'c2' }] },
      ],
      results: [
        result,
        { ...result, id: 'result2', checkItemId: 'c2', verifyRunId: 'r2', verdict: 'uncertain' },
      ],
    });
    mocks.predict
      .mockResolvedValueOnce({ id: 'p1', status: 'judged', action: 'accept' })
      .mockResolvedValueOnce({
        id: 'p2',
        status: 'judged',
        action: 'reject',
        comment: 'Supply evidence.',
      });
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({
      status: 'rejected',
      predictionIds: ['p1', 'p2'],
    });
  });

  it('sends missing evidence back and does not mistake skipped review for approval', async () => {
    mocks.predict.mockResolvedValue({ id: 'p1', status: 'skipped', statusReason: 'no evidence' });
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({ status: 'rejected' });
  });

  it('uses the resolved reviewer instead of requiring the Google pin', async () => {
    await reviewGoalDelivery(db, 'u1', 't1', 'op1');
    expect(mocks.predict.mock.calls[0][0].modelConfig).toEqual({
      model: 'configured-model',
      provider: 'configured-provider',
    });
  });

  it('holds with configuration guidance when no reviewer is available', async () => {
    mocks.reviewModel.mockResolvedValue(undefined);
    const review = await reviewGoalDelivery(db, 'u1', 't1', 'op1');
    expect(review?.status).toBe('errored');
    expect(review?.feedback).toContain('Configure an available model');
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it('does not require a model to honor an existing human approval', async () => {
    mocks.rounds.mockResolvedValue({
      runs: [{ id: 'r1', roundIndex: 1, plan: [check] }],
      results: [{ ...result, userDecision: 'accepted' }],
    });
    mocks.reviewModel.mockResolvedValue(undefined);
    expect((await reviewGoalDelivery(db, 'u1', 't1', 'op1'))?.status).toBe('passed');
    expect(mocks.reviewModel).not.toHaveBeenCalled();
  });

  it('holds on a reviewer error instead of approving or requesting a product fix', async () => {
    mocks.predict.mockResolvedValue({
      id: 'p1',
      status: 'errored',
      statusReason: 'provider unavailable',
    });
    expect(await reviewGoalDelivery(db, 'u1', 't1', 'op1')).toMatchObject({ status: 'errored' });
  });
});

vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));
