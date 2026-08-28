import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingRetryTurn } from './usePendingRetryTurn';

const state = vi.hoisted(() => ({ agentId: 'agt-1', hasNoReply: true, isRetrying: false }));

vi.mock('../../store', () => ({
  dataSelectors: {
    getDisplayMessageById: () => () => ({ agentId: state.agentId }),
    hasNoRenderedReply: () => () => state.hasNoReply,
  },
  messageStateSelectors: {
    isMessageRegenerating: () => () => state.isRetrying,
  },
  useConversationStore: (selector: (s: any) => any) => selector({}),
}));

describe('usePendingRetryTurn', () => {
  beforeEach(() => {
    state.agentId = 'agt-1';
    state.hasNoReply = true;
    state.isRetrying = false;
  });

  // Regression: measured on the real app, `delAndRegenerateMessage` removes the
  // failed reply ~457ms in while the replacement only appears ~712ms in. For that
  // gap the user turn had nothing under it — the error card the user clicked just
  // vanished. Message-level loading cannot cover it: there is no message left.
  it('shows a stand-in while a retry runs and the old reply is already gone', () => {
    state.isRetrying = true;

    expect(usePendingRetryTurn('user-1')).toEqual({ agentId: 'agt-1', showPendingTurn: true });
  });

  it('stops as soon as the replacement reply exists', () => {
    state.isRetrying = true;
    state.hasNoReply = false;

    expect(usePendingRetryTurn('user-1').showPendingTurn).toBe(false);
  });

  it('stays hidden when no retry is running', () => {
    expect(usePendingRetryTurn('user-1').showPendingTurn).toBe(false);
  });
});
