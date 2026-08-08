import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFundsBlockedComposerCue } from './useFundsBlockedComposerCue';

const playFundsBlockedSound = vi.fn();
const useAicoBillingChatGate = vi.fn(() => ({
  blocked: false,
  blockReason: null,
  showTrialCta: false,
  trialActive: false,
  trialAvailable: false,
}));
const useFundsBlockedSoundEnabled = vi.fn(() => false);
const syncFundsBlockedSoundFlagFromUrl = vi.fn();

vi.mock('./playFundsBlockedSound', () => ({
  playFundsBlockedSound: (...args: unknown[]) => playFundsBlockedSound(...args),
}));

vi.mock('./useAicoBillingChatGate', () => ({
  useAicoBillingChatGate: () => useAicoBillingChatGate(),
}));

vi.mock('./fundsBlockedSoundFlag', async () => {
  const actual = await vi.importActual('./fundsBlockedSoundFlag');
  return {
    ...(actual as Record<string, unknown>),
    syncFundsBlockedSoundFlagFromUrl: (...args: unknown[]) =>
      syncFundsBlockedSoundFlagFromUrl(...args),
    useFundsBlockedSoundEnabled: () => useFundsBlockedSoundEnabled(),
  };
});

describe('useFundsBlockedComposerCue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFundsBlockedSoundEnabled.mockReturnValue(false);
    useAicoBillingChatGate.mockReturnValue({
      blocked: false,
      blockReason: null,
      showTrialCta: false,
      trialActive: false,
      trialAvailable: false,
    });
  });

  it('forwards content changes without playing when not blocked', () => {
    useFundsBlockedSoundEnabled.mockReturnValue(true);
    const onChange = vi.fn();
    const { result } = renderHook(() => useFundsBlockedComposerCue());

    act(() => {
      result.current.onMarkdownContentChange(onChange)('hello');
    });

    expect(onChange).toHaveBeenCalledWith('hello');
    expect(playFundsBlockedSound).not.toHaveBeenCalled();
  });

  it('does not play when blocked but the hidden flag is off', () => {
    useAicoBillingChatGate.mockReturnValue({
      blocked: true,
      blockReason: 'PERSONAL_FUNDS_UNAVAILABLE',
      showTrialCta: false,
      trialActive: false,
      trialAvailable: false,
    });
    useFundsBlockedSoundEnabled.mockReturnValue(false);
    const onChange = vi.fn();
    const { result } = renderHook(() => useFundsBlockedComposerCue());

    act(() => {
      result.current.onMarkdownContentChange(onChange)('hi');
    });

    expect(playFundsBlockedSound).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('plays when blocked, flag unlocked, and the user adds characters', () => {
    useAicoBillingChatGate.mockReturnValue({
      blocked: true,
      blockReason: 'PERSONAL_FUNDS_UNAVAILABLE',
      showTrialCta: false,
      trialActive: false,
      trialAvailable: false,
    });
    useFundsBlockedSoundEnabled.mockReturnValue(true);
    const onChange = vi.fn();
    const { result } = renderHook(() => useFundsBlockedComposerCue());

    act(() => {
      result.current.onMarkdownContentChange(onChange)('h');
    });
    act(() => {
      result.current.onMarkdownContentChange(onChange)('hi');
    });

    expect(playFundsBlockedSound).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not play when content shrinks (delete / clear)', () => {
    useAicoBillingChatGate.mockReturnValue({
      blocked: true,
      blockReason: 'PERSONAL_FUNDS_UNAVAILABLE',
      showTrialCta: false,
      trialActive: false,
      trialAvailable: false,
    });
    useFundsBlockedSoundEnabled.mockReturnValue(true);
    const onChange = vi.fn();
    const { result } = renderHook(() => useFundsBlockedComposerCue());

    act(() => {
      result.current.onMarkdownContentChange(onChange)('hi');
    });
    playFundsBlockedSound.mockClear();

    act(() => {
      result.current.onMarkdownContentChange(onChange)('h');
    });
    act(() => {
      result.current.onMarkdownContentChange(onChange)('');
    });

    expect(playFundsBlockedSound).not.toHaveBeenCalled();
  });

  it('syncs the URL flag on mount', () => {
    renderHook(() => useFundsBlockedComposerCue());
    expect(syncFundsBlockedSoundFlagFromUrl).toHaveBeenCalledTimes(1);
  });
});
