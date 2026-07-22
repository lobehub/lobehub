import type { OnboardingUnderstandingPollingResult } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { planUnderstandingRetry, useUnderstanding } from './useUnderstanding';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  getOnboardingTopicId: vi.fn(),
  getSession: vi.fn(),
  retrySource: vi.fn(),
  start: vi.fn(),
  swrStates: new Map<string, { data?: unknown; error?: unknown; mutate?: () => Promise<void> }>(),
}));

vi.mock('@/libs/swr', () => {
  const useMockSWR = (key: unknown) => {
    const flatKey = Array.isArray(key) ? key[0] : key;
    const state = (flatKey && mocks.swrStates.get(String(flatKey))) || {};
    return { data: state.data, error: state.error, mutate: state.mutate ?? vi.fn() };
  };
  return { useClientPollingSWR: useMockSWR, useOnlyFetchOnceSWR: useMockSWR };
});

vi.mock('@/services/onboardingUnderstanding', () => ({
  onboardingUnderstandingService: {
    confirm: mocks.confirm,
    getOnboardingTopicId: mocks.getOnboardingTopicId,
    getSession: mocks.getSession,
    retrySource: mocks.retrySource,
    start: mocks.start,
  },
}));

const failedRun = (id: string) =>
  ({
    source: { externalAccountId: 'acc', id, provider: 'github' },
    status: 'failed',
    threadId: `thread-${id}`,
  }) as OnboardingUnderstandingPollingResult['runs'][number];

const session = (
  overrides: Partial<OnboardingUnderstandingPollingResult>,
): OnboardingUnderstandingPollingResult => ({
  id: 'session-1',
  runs: [],
  status: 'processing',
  ...overrides,
});

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.retrySource.mockReset().mockResolvedValue(session({}));
  mocks.swrStates.clear();
});

describe('planUnderstandingRetry', () => {
  it('restarts when there is no session or the session has no runs', () => {
    expect(planUnderstandingRetry(undefined)).toEqual({ kind: 'restart' });
    expect(planUnderstandingRetry(session({}))).toEqual({ kind: 'restart' });
  });

  it('restarts when no run is retryable', () => {
    expect(
      planUnderstandingRetry(session({ runs: [{ ...failedRun('a'), status: 'completed' }] })),
    ).toEqual({ kind: 'restart' });
  });

  it('retries every failed or stale source', () => {
    expect(
      planUnderstandingRetry(
        session({ runs: [failedRun('a'), { ...failedRun('b'), status: 'stale' }] }),
      ),
    ).toEqual({ kind: 'retry-sources', sessionId: 'session-1', sourceIds: ['a', 'b'] });
  });
});

describe('useUnderstanding', () => {
  it('exposes the polled session over the start snapshot', () => {
    mocks.swrStates.set('onboarding:understandingTopic', { data: 'topic-1' });
    mocks.swrStates.set('onboarding:understandingStart', { data: session({ status: 'pending' }) });
    mocks.swrStates.set('onboarding:understandingSession', {
      data: session({ status: 'completed' }),
    });

    const { result } = renderHook(() => useUnderstanding());

    expect(result.current.result?.status).toBe('completed');
  });

  it('retries failed sources against the current session', async () => {
    mocks.swrStates.set('onboarding:understandingTopic', { data: 'topic-1' });
    mocks.swrStates.set('onboarding:understandingStart', { data: session({}) });
    mocks.swrStates.set('onboarding:understandingSession', {
      data: session({ runs: [failedRun('a')], status: 'failed' }),
    });

    const { result } = renderHook(() => useUnderstanding());

    await act(() => result.current.retry());

    expect(mocks.retrySource).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceId: 'a',
      topicId: 'topic-1',
    });
  });

  it('confirms only a merged display result', async () => {
    mocks.swrStates.set('onboarding:understandingTopic', { data: 'topic-1' });
    mocks.swrStates.set('onboarding:understandingStart', { data: session({}) });
    mocks.swrStates.set('onboarding:understandingSession', {
      data: session({
        displayResult: {
          kind: 'merged',
          result: {
            analysis: {} as never,
            diagnostics: { errors: [], evidenceCount: 0, failedCount: 0, succeededCount: 0 },
            inputThreadIds: [],
            kind: 'merged',
            resultId: 'result-1',
          },
        },
        status: 'completed',
      }),
    });

    const { result } = renderHook(() => useUnderstanding());

    await act(() => result.current.confirm());

    expect(mocks.confirm).toHaveBeenCalledWith({
      resultId: 'result-1',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
  });

  it('skips confirmation for provisional results', async () => {
    mocks.swrStates.set('onboarding:understandingTopic', { data: 'topic-1' });
    mocks.swrStates.set('onboarding:understandingStart', { data: session({}) });
    mocks.swrStates.set('onboarding:understandingSession', {
      data: session({
        displayResult: {
          kind: 'provisional',
          result: {
            analysis: {} as never,
            diagnostics: { errors: [], evidenceCount: 0, failedCount: 0, succeededCount: 0 },
            kind: 'source',
            resultId: 'result-1',
            source: { externalAccountId: 'acc', id: 'a', provider: 'github' },
          },
        },
      }),
    });

    const { result } = renderHook(() => useUnderstanding());

    await act(() => result.current.confirm());

    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
