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

  it('triggerExtract skips when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: false, isGreeting: false }),
    );
    await result.current.triggerExtract('topic-1', 'discovery');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when phase is undefined', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false }),
    );
    await result.current.triggerExtract('topic-1', undefined);
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when phase is summary', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false }),
    );
    await result.current.triggerExtract('topic-1', 'summary');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when isGreeting is true', async () => {
    const { result } = renderHook(() => useOnboardingFollowUp({ enabled: true, isGreeting: true }));
    await result.current.triggerExtract('topic-1', 'agent_identity');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract fires fetchFor with onboarding hint on a normal turn', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false }),
    );
    await result.current.triggerExtract('topic-1', 'discovery');
    expect(fetchFor).toHaveBeenCalledWith('topic-1', {
      kind: 'onboarding',
      phase: 'discovery',
    });
  });

  it('onBeforeSendMessage clears when enabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: true, isGreeting: false }),
    );
    await result.current.onBeforeSendMessage();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('onBeforeSendMessage does nothing when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({ enabled: false, isGreeting: false }),
    );
    await result.current.onBeforeSendMessage();
    expect(clear).not.toHaveBeenCalled();
  });
});
