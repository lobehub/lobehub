import { describe, expect, it } from 'vitest';

import { resolveMessageListFeedback } from './resolveMessageListFeedback';

describe('resolveMessageListFeedback', () => {
  it.each([
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: true,
      },
      name: 'first load pending',
      state: {
        error: undefined,
        isNewConversation: false,
        isStreaming: false,
        messagesInit: false,
      },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: true,
        showSkeleton: false,
      },
      name: 'first load failed',
      state: {
        error: new Error('offline'),
        isNewConversation: false,
        isStreaming: false,
        messagesInit: false,
      },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: false,
      },
      name: 'settled list validating silently',
      state: { error: undefined, isNewConversation: false, isStreaming: false, messagesInit: true },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: true,
        showFirstLoadError: false,
        showSkeleton: false,
      },
      name: 'cached list waiting on its first server fetch',
      state: {
        error: undefined,
        isInitialRevalidation: true,
        isNewConversation: false,
        isStreaming: false,
        messagesInit: true,
      },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: true,
      },
      name: 'first load keeps the skeleton instead of the refreshing hint',
      state: {
        error: undefined,
        isInitialRevalidation: true,
        isNewConversation: false,
        isStreaming: false,
        messagesInit: false,
      },
    },
    {
      expected: {
        showBackgroundError: true,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: false,
      },
      name: 'settled empty list failed in the background',
      state: {
        error: new Error('offline'),
        isNewConversation: false,
        isStreaming: false,
        messagesInit: true,
      },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: false,
      },
      name: 'streaming keeps its existing source of truth',
      state: {
        error: new Error('offline'),
        isNewConversation: false,
        isStreaming: true,
        messagesInit: true,
      },
    },
    {
      expected: {
        showBackgroundError: false,
        showRefreshing: false,
        showFirstLoadError: false,
        showSkeleton: false,
      },
      name: 'new conversation remains on welcome',
      state: {
        error: undefined,
        isNewConversation: true,
        isStreaming: false,
        messagesInit: false,
      },
    },
  ])('$name', ({ expected, state }) => {
    expect(resolveMessageListFeedback(state)).toEqual(expected);
  });
});
