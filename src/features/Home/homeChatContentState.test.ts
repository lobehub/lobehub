import { describe, expect, it } from 'vitest';

import { resolveHomeChatContentState } from './homeChatContentState';

const baseState = {
  activityCount: 0,
  activityError: false,
  activityResolved: true,
  authLoaded: true,
  hasError: false,
  isLogin: true,
  recentsCount: 1,
  recentsInit: true,
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
        activityCount: 1,
        recentsCount: 0,
        activityResolved: false,
      }),
    ).toBe('ready');
  });

  it('waits for the running feed before declaring the chat surface empty', () => {
    expect(
      resolveHomeChatContentState({
        ...baseState,
        recentsCount: 0,
        activityResolved: false,
      }),
    ).toBe('loading');
  });

  it('keeps blocking briefs visible when there are no topics or recents', () => {
    expect(
      resolveHomeChatContentState({
        ...baseState,
        activityCount: 1,
        recentsCount: 0,
      }),
    ).toBe('ready');
  });

  it('renders the inbox error instead of starter suggestions', () => {
    expect(
      resolveHomeChatContentState({
        ...baseState,
        activityError: true,
        recentsCount: 0,
      }),
    ).toBe('ready');
  });
});
