import type { OnboardingProfileResult } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProfile } from './useProfile';

const mocks = vi.hoisted(() => ({
  useClientDataSWR: vi.fn(
    (): { data: OnboardingProfileResult | undefined; isLoading: boolean } => ({
      data: undefined,
      isLoading: true,
    }),
  ),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('@/services/onboardingAnalysis', () => ({
  onboardingAnalysisService: {
    getProfile: vi.fn(),
  },
}));

beforeEach(() => {
  mocks.useClientDataSWR.mockClear().mockReturnValue({ data: undefined, isLoading: true });
});

describe('useProfile', () => {
  it('reports loading while the profile is not resolved yet', () => {
    const { result } = renderHook(() => useProfile());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.profile).toBeUndefined();
  });

  it('returns undefined without crashing when the profile is missing', () => {
    mocks.useClientDataSWR.mockReturnValue({ data: undefined, isLoading: false });

    const { result } = renderHook(() => useProfile());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeUndefined();
  });

  it('surfaces the resolved profile', () => {
    const profile = {
      identity: ['Pragmatic designer-engineer.'],
      name: 'Canis Minor',
      subtitle: 'Pragmatic designer-engineer who ships research-grade editors',
      tagline: 'Ships fast, cares deeply.',
    };
    mocks.useClientDataSWR.mockReturnValue({ data: profile, isLoading: false });

    const { result } = renderHook(() => useProfile());

    expect(result.current.profile).toEqual(profile);
  });
});
