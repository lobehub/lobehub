import { describe, expect, it } from 'vitest';

import { resolveAgentListContentState } from './agentListContentState';

describe('resolveAgentListContentState', () => {
  it('keeps loading rows while authentication is unresolved', () => {
    expect(resolveAgentListContentState({ authLoaded: false, isInit: false, isLogin: false })).toBe(
      'loading',
    );
  });

  it('settles to the built-in inbox without permanent skeletons for anonymous users', () => {
    expect(resolveAgentListContentState({ authLoaded: true, isInit: false, isLogin: false })).toBe(
      'inbox',
    );
  });

  it('renders the resolved list once agent data initializes', () => {
    expect(resolveAgentListContentState({ authLoaded: true, isInit: true, isLogin: true })).toBe(
      'ready',
    );
  });
});
