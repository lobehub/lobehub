import { describe, expect, it } from 'vitest';

import { resolveHomeChatContentState } from './homeChatContentState';

const baseState = {
  authLoaded: true,
  hasError: false,
  isLogin: true,
  recentsCount: 1,
  recentsInit: true,
  runningCount: 0,
  runningResolved: true,
};

describe('resolveHomeChatContentState', () => {
  it('keeps a structural loading state until authentication resolves', () => {
    expect(resolveHomeChatContentState({ ...baseState, authLoaded: false })).toBe('loading');
  });

  it('shows the starter state for a resolved anonymous session', () => {
    expect(resolveHomeChatContentState({ ...baseState, isLogin: false })).toBe('empty');
  });

  it('distinguishes loading, error, empty, and populated recents', () => {
    expect(resolveHomeChatContentState({ ...baseState, recentsInit: false })).toBe('loading');
    expect(resolveHomeChatContentState({ ...baseState, hasError: true, recentsInit: false })).toBe(
      'error',
    );
    expect(resolveHomeChatContentState({ ...baseState, recentsCount: 0 })).toBe('empty');
    expect(resolveHomeChatContentState(baseState)).toBe('ready');
  });

  it('keeps running topics visible when there are no recent topics', () => {
    expect(
      resolveHomeChatContentState({
        ...baseState,
        recentsCount: 0,
        runningCount: 1,
        runningResolved: false,
      }),
    ).toBe('ready');
  });

  it('waits for the running feed before declaring the chat surface empty', () => {
    expect(
      resolveHomeChatContentState({
        ...baseState,
        recentsCount: 0,
        runningResolved: false,
      }),
    ).toBe('loading');
  });
});
