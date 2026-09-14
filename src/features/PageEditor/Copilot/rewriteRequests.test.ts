import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPageRewriteReviewFailure,
  getActivePageRewriteRequestIds,
  getPageRewriteReviewFailure,
  groupPageRewriteRequests,
  normalizePageRewriteProgress,
  type PageRewriteRequest,
  recordPageRewriteReviewFailure,
  settlePageRewriteReview,
} from './rewriteRequests';

const mocks = vi.hoisted(() => ({
  cancel: { mutate: vi.fn() },
  create: { mutate: vi.fn() },
  list: { query: vi.fn() },
  review: { mutate: vi.fn() },
  retry: { mutate: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    documentRewrite: mocks,
  },
}));

const settlement = {
  attempt: 2,
  expectedCommandId: 'command-review',
  id: 'request-review',
  stateVector: 'proof-state-vector',
  status: 'applied' as const,
};

describe('settlePageRewriteReview', () => {
  afterEach(() => {
    clearPageRewriteReviewFailure(settlement.id);
    vi.clearAllMocks();
  });

  it('retries transient review failures with bounded exponential delays and the same CAS payload', async () => {
    const review = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary-1'))
      .mockRejectedValueOnce(new Error('temporary-2'))
      .mockResolvedValueOnce({ status: 'applied' });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      settlePageRewriteReview(settlement, {
        baseDelayMs: 10,
        review,
        sleep,
      }),
    ).resolves.toEqual({ status: 'applied' });

    expect(review).toHaveBeenCalledTimes(3);
    expect(review.mock.calls).toEqual([[settlement], [settlement], [settlement]]);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
    expect(getPageRewriteReviewFailure(settlement.id)).toBeNull();
  });

  it('retains a final failure for the Page panel instead of silently dropping the review', async () => {
    const review = vi.fn().mockRejectedValue(new Error('permanent-review-failure'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      settlePageRewriteReview(settlement, {
        maxAttempts: 2,
        review,
        sleep,
      }),
    ).rejects.toThrow('permanent-review-failure');

    expect(review).toHaveBeenCalledTimes(2);
    expect(getPageRewriteReviewFailure(settlement.id)).toMatchObject({
      ...settlement,
      errorMessage: 'permanent-review-failure',
    });
  });

  it('allows an explicit retry to clear the retained failure', async () => {
    recordPageRewriteReviewFailure(settlement, new Error('first-failure'));
    expect(getPageRewriteReviewFailure(settlement.id)).not.toBeNull();
    clearPageRewriteReviewFailure(settlement.id);
    expect(getPageRewriteReviewFailure(settlement.id)).toBeNull();
  });

  it('coalesces a toolbar and panel settlement for the same durable review', async () => {
    const review = vi.fn().mockResolvedValue({ status: 'applied' });
    const first = settlePageRewriteReview(settlement, { review });
    const second = settlePageRewriteReview(settlement, { review });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'applied' },
      { status: 'applied' },
    ]);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('counts only active generation states and deduplicates request ids', () => {
    expect(
      getActivePageRewriteRequestIds([
        { id: 'active', status: 'thinking' },
        { id: 'active', status: 'writing' },
        { id: 'queued', status: 'queued' },
        { id: 'legacy-review', status: 'awaiting_review' },
        { id: 'legacy-cancel', status: 'canceled_after_write' },
        { id: 'done', status: 'applied' },
      ]),
    ).toEqual(['active', 'queued']);
  });
});

const makeRequest = (
  id: string,
  overrides: Partial<PageRewriteRequest> = {},
): PageRewriteRequest => ({
  agentId: 'agent-1',
  attempt: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  documentId: 'page-1',
  id,
  instruction: id,
  selection: {},
  status: 'applied',
  updatedAt: '2026-08-29T00:00:00.000Z',
  ...overrides,
});

describe('groupPageRewriteRequests', () => {
  it('groups durable sessions, keeps legacy requests isolated, and orders attention first', () => {
    const groups = groupPageRewriteRequests([
      makeRequest('session-one-round-one', {
        sessionId: 'session-one',
        turnIndex: 1,
      }),
      makeRequest('session-one-round-two', {
        errorMessage: 'generation failed',
        sessionId: 'session-one',
        status: 'failed',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:02.000Z',
      }),
      makeRequest('active-session', {
        sessionId: 'active-session',
        status: 'thinking',
        updatedAt: '2026-08-29T00:00:01.000Z',
      }),
      makeRequest('legacy-a'),
      makeRequest('legacy-b', { updatedAt: '2026-08-29T00:00:03.000Z' }),
    ]);

    expect(groups.map(({ key }) => key)).toEqual([
      'active-session',
      'session-one',
      'legacy-b',
      'legacy-a',
    ]);
    expect(groups[1]?.requests.map(({ id }) => id)).toEqual([
      'session-one-round-two',
      'session-one-round-one',
    ]);
    expect(groups.slice(2).every(({ requests }) => requests.length === 1)).toBe(true);
  });

  it('orders different sessions by latest updated time, not their turn count', () => {
    const groups = groupPageRewriteRequests([
      makeRequest('old-session-round-one', {
        createdAt: '2026-08-29T00:00:01.000Z',
        sessionId: 'old-session',
        turnIndex: 1,
        updatedAt: '2026-08-29T00:00:01.000Z',
      }),
      makeRequest('old-session-round-two', {
        createdAt: '2026-08-29T00:00:02.000Z',
        sessionId: 'old-session',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:02.000Z',
      }),
      makeRequest('new-session-round-one', {
        createdAt: '2026-08-29T00:00:03.000Z',
        sessionId: 'new-session',
        turnIndex: 1,
        updatedAt: '2026-08-29T00:00:03.000Z',
      }),
    ]);

    expect(groups.map(({ key }) => key)).toEqual(['new-session', 'old-session']);
    expect(groups[1]?.requests[0]?.id).toBe('old-session-round-two');
  });

  it('keeps same-session turn order and same-time ties deterministic', () => {
    const groups = groupPageRewriteRequests([
      makeRequest('same-session-a', {
        createdAt: '2026-08-29T00:00:04.000Z',
        sessionId: 'same-session',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:04.000Z',
      }),
      makeRequest('same-session-b', {
        createdAt: '2026-08-29T00:00:04.000Z',
        sessionId: 'same-session',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:04.000Z',
      }),
      makeRequest('same-session-round-one', {
        createdAt: '2026-08-29T00:00:03.000Z',
        sessionId: 'same-session',
        turnIndex: 1,
        updatedAt: '2026-08-29T00:00:03.000Z',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.requests.map(({ id }) => id)).toEqual([
      'same-session-b',
      'same-session-a',
      'same-session-round-one',
    ]);
  });
});

describe('normalizePageRewriteProgress', () => {
  it('keeps public stage order and strips raw reasoning/provider payloads', () => {
    const progress = normalizePageRewriteProgress({
      currentStage: 'generating_replacement',
      events: [
        {
          at: '2026-09-04T00:00:00.000Z',
          stage: 'analyzing_context',
          thinking_delta: 'PRIVATE_CHAIN_OF_THOUGHT',
        },
        {
          at: '2026-09-04T00:00:01.000Z',
          arguments: 'sensitive document text',
          stage: 'reading_search',
          tool: 'search_document_text',
        },
        {
          at: '2026-09-04T00:00:02.000Z',
          stage: 'generating_replacement',
          summary: 'Safe provider summary',
        },
      ],
      reasoning: 'PRIVATE_CHAIN_OF_THOUGHT',
      updatedAt: '2026-09-04T00:00:02.000Z',
    });

    expect(progress?.events.map((event) => event.stage)).toEqual([
      'analyzing_context',
      'reading_search',
      'generating_replacement',
    ]);
    expect(progress?.events[1]).not.toHaveProperty('arguments');
    expect(progress?.events[2]?.summary).toBe('Safe provider summary');
    expect(JSON.stringify(progress)).not.toContain('PRIVATE_CHAIN_OF_THOUGHT');
    expect(JSON.stringify(progress)).not.toContain('sensitive document text');
  });

  it('caps public progress events and ignores unknown stages/tools', () => {
    const progress = normalizePageRewriteProgress({
      currentStage: 'reading_block',
      events: Array.from({ length: 40 }, (_, index) => ({
        at: `2026-09-04T00:00:${String(index).padStart(2, '0')}.000Z`,
        stage: index === 39 ? 'reading_block' : 'thinking_delta',
        tool: index === 39 ? 'read_document_block' : 'private_tool',
      })),
      updatedAt: '2026-09-04T00:01:00.000Z',
    });

    expect(progress?.events).toHaveLength(1);
    expect(progress?.events[0]).toMatchObject({
      stage: 'reading_block',
      tool: 'read_document_block',
    });
  });
});
