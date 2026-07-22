import type {
  OnboardingAnalysisStatus,
  OnboardingUnderstandingPollingResult,
} from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UnderstandingController } from '../../understanding/useUnderstanding';
import {
  buildLearnYourWorldViewModel,
  useLearnYourWorldAnalysis,
} from './useLearnYourWorldAnalysis';

const mocks = vi.hoisted(() => ({
  useUnderstanding: vi.fn((): Partial<UnderstandingController> => ({
    retry: vi.fn(),
    retrying: false,
  })),
}));

vi.mock('../../understanding/useUnderstanding', () => ({
  useUnderstanding: mocks.useUnderstanding,
}));

beforeEach(() => {
  mocks.useUnderstanding.mockClear().mockReturnValue({ retry: vi.fn(), retrying: false });
});

describe('buildLearnYourWorldViewModel', () => {
  it('fills unknown fact slots with skeletons and keeps every progress item pending', () => {
    const view = buildLearnYourWorldViewModel(undefined);

    expect(view.facts).toEqual([]);
    expect(view.skeletonCount).toBe(4);
    expect(view.progressItems).toEqual([
      { id: 'review', status: 'pending' },
      { id: 'build', status: 'pending' },
      { id: 'explore', status: 'pending' },
    ]);
    expect(view.buttonLabel).toBe('skip');
    expect(view.done).toBe(false);
  });

  it('reduces skeleton count as facts stream in and maps known progress statuses', () => {
    const status: OnboardingAnalysisStatus = {
      done: false,
      facts: [
        { id: 'a', label: 'Canis Minor - Designer' },
        { id: 'b', label: 'Organization: LobeHub' },
      ],
      items: [
        { id: 'review', status: 'done' },
        { id: 'build', status: 'running' },
      ],
    };

    const view = buildLearnYourWorldViewModel(status);

    expect(view.skeletonCount).toBe(2);
    expect(view.progressItems).toEqual([
      { id: 'review', status: 'done' },
      { id: 'build', status: 'running' },
      { id: 'explore', status: 'pending' },
    ]);
    expect(view.buttonLabel).toBe('skip');
  });

  it('switches the button label to continue once analysis is done', () => {
    const status: OnboardingAnalysisStatus = { done: true, facts: [], items: [] };

    expect(buildLearnYourWorldViewModel(status).buttonLabel).toBe('continue');
  });
});

describe('useLearnYourWorldAnalysis', () => {
  it('stays on the initial skip state without a session', () => {
    const { result } = renderHook(() => useLearnYourWorldAnalysis());

    expect(result.current.buttonLabel).toBe('skip');
    expect(result.current.skeletonCount).toBe(4);
    expect(result.current.facts).toEqual([]);
    expect(result.current.failed).toBe(false);
  });

  it('flags failure when the understanding request errors', () => {
    mocks.useUnderstanding.mockReturnValue({
      error: new Error('boom'),
      retry: vi.fn(),
      retrying: false,
    });

    const { result } = renderHook(() => useLearnYourWorldAnalysis());

    expect(result.current.failed).toBe(true);
    expect(result.current.buttonLabel).toBe('skip');
  });

  it('completes once the session reaches a done status', () => {
    const session: OnboardingUnderstandingPollingResult = {
      id: 'session-1',
      runs: [
        {
          source: { externalAccountId: 'acc', id: 'a', provider: 'github' },
          status: 'completed',
          threadId: 'thread-a',
        },
      ],
      status: 'completed',
    };
    mocks.useUnderstanding.mockReturnValue({ result: session, retry: vi.fn(), retrying: false });

    const { result } = renderHook(() => useLearnYourWorldAnalysis());

    expect(result.current.buttonLabel).toBe('continue');
    expect(result.current.done).toBe(true);
    expect(result.current.failed).toBe(false);
  });
});
