import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationChatInputUiState } from './useConversationChatInputUiState';

// A real (reactive) stand-in for the ConversationStore slice the hook reads, so
// the test proves the composer follows the run's op state over time — not just
// that it read it once. A composer that only tracked its own submit flag would
// miss a run started outside it (another tab, a scheduled run, `runTask`).
const storeMock = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('../store', async () => {
  const { create } = await import('zustand');
  const useFakeStore = create<{ operationState: { isInputVisiblyLoading: boolean } }>(() => ({
    operationState: { isInputVisiblyLoading: false },
  }));
  storeMock.current = useFakeStore;

  return {
    messageStateSelectors: {
      isInputVisiblyLoading: (s: { operationState: { isInputVisiblyLoading: boolean } }) =>
        s.operationState.isInputVisiblyLoading,
    },
    useConversationStore: (selector: (s: unknown) => unknown) => useFakeStore(selector as never),
  };
});

const setInputVisiblyLoading = (value: boolean) =>
  act(() => {
    storeMock.current.setState({ operationState: { isInputVisiblyLoading: value } });
  });

describe('useConversationChatInputUiState', () => {
  beforeEach(() => {
    setInputVisiblyLoading(false);
  });

  it('follows a run that flips to loading after the composer is mounted', () => {
    const { result } = renderHook(() => useConversationChatInputUiState({ isInputEmpty: true }));

    expect(result.current.showStopButton).toBe(false);

    setInputVisiblyLoading(true);

    expect(result.current.showStopButton).toBe(true);
    expect(result.current.placeholderVariant).toBe('followUp');
  });

  it('swaps Send for Stop while the run is visibly loading', () => {
    setInputVisiblyLoading(true);

    const { result } = renderHook(() => useConversationChatInputUiState({ isInputEmpty: true }));

    expect(result.current).toEqual({
      placeholderVariant: 'followUp',
      showSendMenu: false,
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });

  it('keeps Send beside Stop so a typed follow-up can be queued', () => {
    setInputVisiblyLoading(true);

    const { result } = renderHook(() => useConversationChatInputUiState({ isInputEmpty: false }));

    expect(result.current.showStopButton).toBe(true);
    expect(result.current.showSendWhileGenerating).toBe(true);
  });

  it('drops the queued Send when the host refuses to queue', () => {
    setInputVisiblyLoading(true);

    const { result } = renderHook(() =>
      useConversationChatInputUiState({ disableQueue: true, isInputEmpty: false }),
    );

    expect(result.current.showStopButton).toBe(true);
    expect(result.current.showSendWhileGenerating).toBe(false);
  });

  it('offers a plain Send once the run is no longer loading', () => {
    const { result } = renderHook(() => useConversationChatInputUiState({ isInputEmpty: false }));

    expect(result.current).toEqual({
      placeholderVariant: 'default',
      showSendMenu: true,
      showSendWhileGenerating: false,
      showStopButton: false,
    });
  });
});
