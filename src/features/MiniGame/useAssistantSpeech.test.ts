import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { latestAssistantSpeech, SPEECH_VISIBLE_MS, useAssistantSpeech } from './useAssistantSpeech';

const messagesMock = vi.hoisted(() => ({ value: [] as any[] }));
vi.mock('@/store/chat/selectors', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    displayMessageSelectors: {
      ...actual.displayMessageSelectors,
      activeDisplayMessages: () => messagesMock.value,
    },
  };
});

const setMessages = (messages: any[]) =>
  act(() => {
    messagesMock.value = messages;
    // Any store write re-runs the selector.
    useChatStore.setState({ activeTopicId: `t-${Math.random()}` });
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('latestAssistantSpeech', () => {
  it('reads the newest text of a tool-using reply and strips markdown', () => {
    expect(
      latestAssistantSpeech([
        { content: 'go sit', role: 'user' },
        {
          children: [{ content: '**Okay**, on my way!' }, { content: '...' }],
          role: 'assistantGroup',
        },
      ] as any),
    ).toBe('Okay, on my way!');
  });

  it('is silent once the user speaks again', () => {
    expect(
      latestAssistantSpeech([
        { content: 'hi', role: 'assistant' },
        { content: 'go', role: 'user' },
      ] as any),
    ).toBeUndefined();
  });
});

describe('useAssistantSpeech', () => {
  it('hides a line after a while and shows the same line again in the next reply', () => {
    setMessages([{ content: 'On my way!', role: 'assistant' }]);
    const { result } = renderHook(() => useAssistantSpeech());
    expect(result.current).toBe('On my way!');

    act(() => vi.advanceTimersByTime(SPEECH_VISIBLE_MS + 10));
    expect(result.current).toBeUndefined();

    setMessages([{ content: 'go again', role: 'user' }]);
    setMessages([{ content: 'On my way!', role: 'assistant' }]);
    expect(result.current).toBe('On my way!');
  });
});
