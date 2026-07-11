import type { OnboardingAnalysisStatus } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLearnYourWorldViewModel,
  useLearnYourWorldAnalysis,
} from './useLearnYourWorldAnalysis';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startAnalysis: vi.fn(),
  useClientPollingSWR: vi.fn((): { data: OnboardingAnalysisStatus | undefined; error?: Error } => ({
    data: undefined,
  })),
}));

vi.mock('@/libs/swr', () => ({
  useClientPollingSWR: mocks.useClientPollingSWR,
}));

vi.mock('@/services/onboardingAnalysis', () => ({
  onboardingAnalysisService: {
    getStatus: mocks.getStatus,
    startAnalysis: mocks.startAnalysis,
  },
}));

beforeEach(() => {
  mocks.getStatus.mockReset().mockResolvedValue(undefined);
  mocks.startAnalysis.mockReset().mockResolvedValue(undefined);
  mocks.useClientPollingSWR.mockClear().mockReturnValue({ data: undefined });
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
  it('fires startAnalysis once on mount', () => {
    renderHook(() => useLearnYourWorldAnalysis());

    expect(mocks.startAnalysis).toHaveBeenCalledTimes(1);
  });

  it('stays on the initial skip state when the service throws', async () => {
    mocks.startAnalysis.mockRejectedValue(new Error('not implemented'));
    mocks.useClientPollingSWR.mockReturnValue({ data: undefined, error: new Error('boom') });

    const { result } = renderHook(() => useLearnYourWorldAnalysis());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.buttonLabel).toBe('skip');
    expect(result.current.skeletonCount).toBe(4);
    expect(result.current.facts).toEqual([]);
  });

  it('surfaces the polled status from the service', () => {
    mocks.useClientPollingSWR.mockReturnValue({
      data: { done: true, facts: [{ id: 'a', label: 'fact' }], items: [] },
    });

    const { result } = renderHook(() => useLearnYourWorldAnalysis());

    expect(result.current.buttonLabel).toBe('continue');
    expect(result.current.facts).toEqual([{ id: 'a', label: 'fact' }]);
  });
});
