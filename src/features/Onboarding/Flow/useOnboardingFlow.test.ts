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
  trackOnboardingCompleted: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
  trackOnboardingStepViewed: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/services/onboardingMetrics', () => ({
  trackOnboardingCompleted: mocks.trackOnboardingCompleted,
  trackOnboardingStepCompleted: mocks.trackOnboardingStepCompleted,
  trackOnboardingStepViewed: mocks.trackOnboardingStepViewed,
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

  it('fires step viewed once for the initial step', () => {
    renderHook(() => useOnboardingFlow());

    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledWith({
      flow: 'web',
      step: 'welcome',
      stepIndex: OnboardingStep.Welcome,
    });
  });

  it('fires step viewed again when the current step changes', () => {
    const { rerender } = renderHook(() => useOnboardingFlow());
    mocks.trackOnboardingStepViewed.mockClear();

    mocks.persistedStep = OnboardingStep.ChiefAgent;
    rerender();

    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepViewed).toHaveBeenCalledWith({
      flow: 'web',
      step: 'chief_agent',
      stepIndex: OnboardingStep.ChiefAgent,
    });
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
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'web',
      step: 'welcome',
      stepIndex: OnboardingStep.Welcome,
    });
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
    expect(mocks.trackOnboardingStepCompleted).toHaveBeenCalledWith({
      flow: 'web',
      step: 'chief_agent',
      stepIndex: OnboardingStep.ChiefAgent,
    });
    expect(mocks.trackOnboardingCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'web',
      targetUrl: '/chat',
    });
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

  it('next() does not fire step completed when setOnboardingStep rejects', async () => {
    mocks.setOnboardingStep.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useOnboardingFlow());

    await expect(
      act(async () => {
        await result.current.next();
      }),
    ).rejects.toThrow('network error');

    expect(mocks.trackOnboardingStepCompleted).not.toHaveBeenCalled();
  });

  it('next() does not fire step completed when finish() rejects on the last step', async () => {
    mocks.persistedStep = OnboardingStep.ChiefAgent;
    mocks.finishOnboarding.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useOnboardingFlow());

    await expect(
      act(async () => {
        await result.current.next();
      }),
    ).rejects.toThrow('network error');

    expect(mocks.trackOnboardingStepCompleted).not.toHaveBeenCalled();
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

  it('finish() fires onboarding completed directly, e.g. for a global skip', async () => {
    mocks.consumeOnboardingCallbackUrl.mockReturnValue('/chat');

    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.finish();
    });

    expect(mocks.trackOnboardingCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.trackOnboardingCompleted).toHaveBeenCalledWith({
      flow: 'web',
      targetUrl: '/chat',
    });
    expect(mocks.trackOnboardingStepCompleted).not.toHaveBeenCalled();
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
