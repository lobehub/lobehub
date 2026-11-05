import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { PortalViewType } from './initialState';

const viewType = () => chatPortalSelectors.currentViewType(useChatStore.getState());

beforeEach(() => {
  act(() => useChatStore.setState({ portalStack: [], showPortal: false }));
});

describe('toggleMiniGame', () => {
  it('opens the mini game beside the chat and closes it again', () => {
    act(() => useChatStore.getState().toggleMiniGame());
    expect(useChatStore.getState().showPortal).toBe(true);
    expect(viewType()).toBe(PortalViewType.MiniGame);

    act(() => useChatStore.getState().toggleMiniGame());
    expect(useChatStore.getState().showPortal).toBe(false);
  });

  it('opens the mini game over another view instead of closing that view', () => {
    act(() => useChatStore.getState().pushPortalView({ type: PortalViewType.Notebook }));
    act(() => useChatStore.getState().toggleMiniGame());
    expect(viewType()).toBe(PortalViewType.MiniGame);
  });
});

describe('clearPortalStack with keepMiniGame', () => {
  it('keeps an open mini game, so a send that creates a topic does not close it', () => {
    act(() => {
      useChatStore.getState().pushPortalView({ type: PortalViewType.Notebook });
      useChatStore.getState().toggleMiniGame();
    });

    act(() => useChatStore.getState().clearPortalStack({ keepMiniGame: true }));
    expect(useChatStore.getState().showPortal).toBe(true);
    expect(useChatStore.getState().portalStack).toEqual([{ type: PortalViewType.MiniGame }]);
  });

  it('still clears other views, and everything without the option', () => {
    act(() => useChatStore.getState().pushPortalView({ type: PortalViewType.Notebook }));
    act(() => useChatStore.getState().clearPortalStack({ keepMiniGame: true }));
    expect(useChatStore.getState().showPortal).toBe(false);

    act(() => useChatStore.getState().toggleMiniGame());
    act(() => useChatStore.getState().clearPortalStack());
    expect(useChatStore.getState().portalStack).toEqual([]);
  });

  it('is what switching into a newly created topic uses', async () => {
    act(() => useChatStore.getState().toggleMiniGame());
    await act(async () => {
      await useChatStore
        .getState()
        .switchTopic('tpc_created_by_send', { clearNewKey: true, skipRefreshMessage: true });
    });
    expect(viewType()).toBe(PortalViewType.MiniGame);
    expect(useChatStore.getState().showPortal).toBe(true);
  });
});
