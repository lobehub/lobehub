import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollowUpActionStore } from '@/store/followUpAction';

import { useOnboardingFollowUp } from './useOnboardingFollowUp';

describe('useOnboardingFollowUp', () => {
  let fetchFor: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFor = vi.fn();
    clear = vi.fn();
    vi.spyOn(useFollowUpActionStore, 'getState').mockReturnValue({
      fetchFor,
      clear,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: false, isGreeting: false, phase: 'discovery' }),
    );
    await result.current.onAfterMessageCreate({ assistantMessageId: 'm' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('skips when phase is missing', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false, phase: undefined }),
    );
    await result.current.onAfterMessageCreate({ assistantMessageId: 'm' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('skips when phase is summary', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false, phase: 'summary' }),
    );
    await result.current.onAfterMessageCreate({ assistantMessageId: 'm' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('skips when isGreeting is true', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: true, phase: 'agent_identity' }),
    );
    await result.current.onAfterMessageCreate({ assistantMessageId: 'm' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('fires fetchFor with onboarding hint on a normal turn', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false, phase: 'discovery' }),
    );
    await result.current.onAfterMessageCreate({ assistantMessageId: 'last' });
    expect(fetchFor).toHaveBeenCalledWith('last', {
      kind: 'onboarding',
      phase: 'discovery',
    });
  });

  it('onBeforeSendMessage clears when enabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false, phase: 'discovery' }),
    );
    await result.current.onBeforeSendMessage();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('onBeforeSendMessage does nothing when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: false, isGreeting: false, phase: 'discovery' }),
    );
    await result.current.onBeforeSendMessage();
    expect(clear).not.toHaveBeenCalled();
  });
});
