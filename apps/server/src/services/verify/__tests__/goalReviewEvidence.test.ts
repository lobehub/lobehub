// @vitest-environment node
import { REVIEW_PREDICT_PROMPT_VERSION } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { VerifyReviewPredictorService } from '../reviewPredictor';

const mocks = vi.hoisted(() => ({
  result: vi.fn(),
  evidence: vi.fn(),
  existing: vi.fn(),
  upsert: vi.fn(),
  generate: vi.fn(),
  document: vi.fn(),
  file: vi.fn(),
  content: vi.fn(),
  url: vi.fn(),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { findById: mocks.result };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByCheckResult: mocks.evidence };
  }),
}));
vi.mock('@/database/models/verifyReviewPrediction', () => ({
  VerifyReviewPredictionModel: vi.fn(function () {
    return {
      findAdjudicated: mocks.existing,
      upsert: mocks.upsert,
    };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.document };
  }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { findById: mocks.file };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFileAccessUrl: mocks.url, getFileContent: mocks.content };
  }),
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject: mocks.generate };
  }),
}));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.result.mockResolvedValue({ id: 'r1', checkItemTitle: 'Table total', verdict: 'passed' });
  mocks.evidence.mockResolvedValue([{ id: 'e1', type: 'text', content: 'SUM(A1:A3) = 42' }]);
  mocks.generate.mockResolvedValue({
    action: 'reject',
    comment: 'Expected 43, got 42',
    regions: [],
  });
  mocks.upsert.mockImplementation(async (row) => ({ id: 'p1', ...row }));
});
const params = {
  checkResultId: 'r1',
  modelConfig: { model: 'review-model', provider: 'review-provider' },
};
const review = () => new VerifyReviewPredictorService({} as LobeChatDatabase, 'u1');

describe('Goal review evidence', () => {
  it('uses original text and records generation provenance', async () => {
    expect(await review().predict({ ...params, includeTextEvidence: true })).toMatchObject({
      action: 'reject',
      status: 'judged',
    });
    expect(JSON.stringify(mocks.generate.mock.calls[0][0].messages)).toContain('SUM(A1:A3) = 42');
    expect(mocks.generate.mock.calls[0][1].tracing).toMatchObject({
      promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
      scenario: expect.any(String),
      schemaName: expect.any(String),
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'review-model',
        provider: 'review-provider',
        promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
      }),
    );
  });
  it('preserves the ordinary visual-only review behavior', async () => {
    expect(await review().predict(params)).toMatchObject({ status: 'skipped' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('reads attached text files rather than treating paths as proof', async () => {
    mocks.evidence.mockResolvedValue([{ id: 'e1', type: 'text', fileId: 'f1' }]);
    mocks.file.mockResolvedValue({ id: 'f1', size: 10, url: 'evidence-key' });
    mocks.content.mockResolvedValue('Actual command output: 42');
    await review().predict({ ...params, includeTextEvidence: true });
    expect(JSON.stringify(mocks.generate.mock.calls[0][0].messages)).toContain(
      'Actual command output: 42',
    );
  });
  /**
   * Regression: the budget was spent in capture order, so an oversized row
   * consumed it and every later row was dropped without a trace. A Goal
   * delivery lost its own summary that way and was rejected for "missing
   * evidence" it had attached.
   */
  it('keeps a later small evidence row when an earlier attachment is oversized', async () => {
    mocks.evidence.mockResolvedValue([
      { content: 'x'.repeat(70_000), id: 'e1', type: 'text' },
      { content: 'RERUN: all five commands exited 0', id: 'e2', type: 'text' },
    ]);
    await review().predict({ ...params, includeTextEvidence: true });
    expect(JSON.stringify(mocks.generate.mock.calls[0][0].messages)).toContain(
      'RERUN: all five commands exited 0',
    );
  });

  /**
   * Regression: the caption a builder wrote on a text row was dropped, leaving
   * the reviewer to infer what a raw payload was from its bytes. Visual rows had
   * always carried their description.
   */
  it('shows the caption the builder wrote on each text row', async () => {
    mocks.evidence.mockResolvedValue([
      {
        content: 'exit=0',
        description: 'rerun log, byte-identical to round 1',
        id: 'e1',
        type: 'text',
      },
    ]);
    await review().predict({ ...params, includeTextEvidence: true });
    expect(JSON.stringify(mocks.generate.mock.calls[0][0].messages)).toContain(
      'rerun log, byte-identical to round 1',
    );
  });

  /**
   * Regression: frames past the cap were dropped silently, so the model judged a
   * five-frame check on three frames believing that was all of it — and its
   * rejection cited evidence that had been withheld from the request.
   */
  it('tells the reviewer which frames the request held back, and records it', async () => {
    mocks.evidence.mockResolvedValue([
      ...['s1', 's2', 's3', 's4'].map((id) => ({ fileId: id, id, type: 'screenshot' })),
      { content: 'exit=0', id: 't1', type: 'text' },
    ]);
    mocks.file.mockImplementation(async (id: string) => ({ id, size: 10, url: `key-${id}` }));
    mocks.url.mockImplementation(async ({ id }: { id: string }) => `https://x/${id}`);

    const prediction = await review().predict({ ...params, includeTextEvidence: true });
    const payload = JSON.stringify(mocks.generate.mock.calls[0][0].messages);
    expect(payload).toContain('Withheld from this request');
    expect(payload).toContain('1 more frame(s)');
    // The caveat rides on the judged row: "rejected blind" and "rejected having
    // seen everything" are otherwise the same verdict in the agreement stats.
    expect(prediction?.statusReason).toContain('1 more frame(s)');
  });

  it('leaves no caveat on a check whose evidence was fully shown', async () => {
    const prediction = await review().predict({ ...params, includeTextEvidence: true });
    expect(prediction?.statusReason).toBeUndefined();
  });

  it.each([
    [new Error('Connection timed out'), 'Connection timed out'],
    [{ message: 'Rate limit exceeded' }, 'Rate limit exceeded'],
    [{ error: { message: 'Invalid API key' }, errorType: 'ProviderBizError' }, 'Invalid API key'],
    ['Service unavailable', 'Service unavailable'],
    [
      { errorType: 'InvalidProviderAPIKey', request: { apiKey: 'private-key' } },
      'Review model review-provider/review-model could not run (InvalidProviderAPIKey). Check the provider configuration and retry the review.',
    ],
    [
      { unexpected: true },
      'Review model review-provider/review-model could not run. Check the provider configuration and retry the review.',
    ],
  ])('preserves an actionable reason for provider failure %#', async (error, reason) => {
    mocks.generate.mockRejectedValue(error);
    const prediction = await review().predict({ ...params, includeTextEvidence: true });
    expect(prediction).toMatchObject({ status: 'errored', statusReason: reason });
    expect(prediction?.statusReason).not.toContain('[object Object]');
    expect(prediction?.statusReason).not.toContain('private-key');
  });
  it('never turns malformed model output into approval', async () => {
    mocks.generate.mockResolvedValue({ action: 'maybe' });
    expect(await review().predict({ ...params, includeTextEvidence: true })).toMatchObject({
      status: 'errored',
    });
  });
});
