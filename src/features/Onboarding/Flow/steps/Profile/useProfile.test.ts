import type { OnboardingUnderstandingPollingResult } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UnderstandingController } from '../../understanding/useUnderstanding';
import { useProfile } from './useProfile';

const mocks = vi.hoisted(() => ({
  useUnderstanding: vi.fn((): Partial<UnderstandingController> => ({ confirm: vi.fn() })),
}));

vi.mock('../../understanding/useUnderstanding', () => ({
  useUnderstanding: mocks.useUnderstanding,
}));

const mergedSession = (): OnboardingUnderstandingPollingResult => ({
  displayResult: {
    kind: 'merged',
    result: {
      analysis: {
        composition: { identities: [], interests: [], lifeStyle: [], social: [], working: [] },
        personaProposal: { content: 'c', reasoning: 'r', tagline: 't' },
        profile: {
          description: 'Pragmatic designer-engineer.',
          domains: [],
          name: 'Canis Minor',
          pronoun: 'they/them',
          roles: [],
          summary: 'Ships fast, cares deeply.',
          tagline: 'Pragmatic designer-engineer who ships research-grade editors',
        },
      },
      diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      inputThreadIds: [],
      kind: 'merged',
      resultId: 'result-1',
    },
  },
  id: 'session-1',
  runs: [],
  status: 'completed',
});

beforeEach(() => {
  mocks.useUnderstanding.mockClear().mockReturnValue({ confirm: vi.fn() });
});

describe('useProfile', () => {
  it('reports loading while the session is still processing', () => {
    mocks.useUnderstanding.mockReturnValue({
      confirm: vi.fn(),
      result: { id: 'session-1', runs: [], status: 'processing' },
    });

    const { result } = renderHook(() => useProfile());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.profile).toBeUndefined();
  });

  it('stops loading without a profile when the session failed', () => {
    mocks.useUnderstanding.mockReturnValue({
      confirm: vi.fn(),
      result: { id: 'session-1', runs: [], status: 'failed' },
    });

    const { result } = renderHook(() => useProfile());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeUndefined();
  });

  it('surfaces the merged profile', () => {
    mocks.useUnderstanding.mockReturnValue({ confirm: vi.fn(), result: mergedSession() });

    const { result } = renderHook(() => useProfile());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toEqual({
      identity: ['Pragmatic designer-engineer.'],
      name: 'Canis Minor',
      subtitle: 'Pragmatic designer-engineer who ships research-grade editors',
      tagline: 'Ships fast, cares deeply.',
    });
  });

  it('swallows confirmation failures so the flow can continue', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('conflict'));
    mocks.useUnderstanding.mockReturnValue({ confirm, result: mergedSession() });

    const { result } = renderHook(() => useProfile());

    await expect(result.current.confirmProfile()).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
