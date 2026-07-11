import { OnboardingStep } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOnboardingFlow } from './useOnboardingFlow';

const mocks = vi.hoisted(() => ({
  composio: false,
  consumeOnboardingCallbackUrl: vi.fn(),
  finishOnboarding: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  persistedStep: undefined as number | undefined,
  setOnboardingStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      finishOnboarding: mocks.finishOnboarding,
      localOnboardingStep: mocks.persistedStep,
      onboarding: undefined,
      setOnboardingStep: mocks.setOnboardingStep,
    }),
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableComposio: () => mocks.composio,
  },
  useServerConfigStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ serverConfig: { enableComposio: mocks.composio } }),
}));

vi.mock('@/utils/onboardingRedirect', () => ({
  consumeOnboardingCallbackUrl: () => mocks.consumeOnboardingCallbackUrl(),
}));

beforeEach(() => {
  mocks.composio = false;
  mocks.persistedStep = undefined;
  mocks.consumeOnboardingCallbackUrl.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOnboardingFlow', () => {
  it('resumes on Welcome when nothing is persisted', () => {
    const { result } = renderHook(() => useOnboardingFlow());

    expect(result.current.currentStep).toBe(OnboardingStep.Welcome);
    expect(result.current.hasPrevious).toBe(false);
    expect(result.current.isLast).toBe(false);
    expect(result.current.visibleSteps).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ChiefAgent,
    ]);
  });

  it('resumes on the nearest visible step for a hidden persisted step', () => {
    mocks.persistedStep = OnboardingStep.ConnectApps;

    const { result } = renderHook(() => useOnboardingFlow());

    expect(result.current.currentStep).toBe(OnboardingStep.ChiefAgent);
  });

  it('next() advances to the next visible step via setOnboardingStep', async () => {
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.next();
    });

    expect(mocks.setOnboardingStep).toHaveBeenCalledWith(OnboardingStep.ChiefAgent);
    expect(mocks.finishOnboarding).not.toHaveBeenCalled();
  });

  it('next() finishes onboarding on the last visible step', async () => {
    mocks.persistedStep = OnboardingStep.ChiefAgent;
    mocks.consumeOnboardingCallbackUrl.mockReturnValue('/chat');

    const { result } = renderHook(() => useOnboardingFlow());
    expect(result.current.isLast).toBe(true);

    await act(async () => {
      await result.current.next();
    });

    expect(mocks.finishOnboarding).toHaveBeenCalled();
    expect(mocks.setOnboardingStep).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/chat');
  });

  it('next() falls back to "/" when there is no stashed callback url', async () => {
    mocks.persistedStep = OnboardingStep.ChiefAgent;
    mocks.consumeOnboardingCallbackUrl.mockReturnValue(undefined);

    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.next();
    });

    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('back() is a no-op on the first visible step', async () => {
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.back();
    });

    expect(mocks.setOnboardingStep).not.toHaveBeenCalled();
  });

  it('back() moves to the previous visible step', async () => {
    mocks.persistedStep = OnboardingStep.ChiefAgent;

    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.back();
    });

    expect(mocks.setOnboardingStep).toHaveBeenCalledWith(OnboardingStep.Welcome);
  });

  it('includes the full step set when every capability is enabled', () => {
    mocks.composio = true;

    const { result } = renderHook(() => useOnboardingFlow());

    expect(result.current.visibleSteps).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ConnectApps,
      OnboardingStep.ChiefAgent,
    ]);
  });
});
