/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useChatStore } from '@/store/chat/store';

import { usePortalThreadHydration } from './usePortalThreadHydration';

const mount = (url: string) => {
  // Every navigation gets a new location key; count them to catch extra writes.
  const keys: string[] = [];
  const hook = renderHook(
    () => {
      usePortalThreadHydration();
      const location = useLocation();
      if (keys.at(-1) !== location.key) keys.push(location.key);
      return { location, navigate: useNavigate() };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children),
    },
  );

  return { ...hook, keys };
};

describe('usePortalThreadHydration', () => {
  beforeEach(() => {
    useChatStore.setState({ ...initialChatState }, false);
  });

  it('opens the side panel for a ?portalThread= link', async () => {
    mount('/agent/agt_1/tpc_a?portalThread=thd_a');

    await waitFor(() => {
      expect(useChatStore.getState().portalStack).toEqual([
        { threadId: 'thd_a', type: PortalViewType.Thread },
      ]);
    });
  });

  /** @example T-2769: the param leaving the URL (topic switch, "open in main", Back) closes the pane. */
  it('closes the pane instead of leaving it empty when ?portalThread= goes away', async () => {
    const { keys, result } = mount('/agent/agt_1/tpc_a?portalThread=thd_a');
    await waitFor(() => expect(useChatStore.getState().showPortal).toBe(true));

    await act(async () => {
      result.current.navigate('/agent/agt_1/tpc_b', { replace: true });
    });

    await waitFor(() => {
      expect(useChatStore.getState().showPortal).toBe(false);
      expect(useChatStore.getState().portalStack).toEqual([]);
    });
    // Following the URL must not navigate again: a write built from the old
    // query would put the old topic's thread back.
    expect(result.current.location.pathname).toBe('/agent/agt_1/tpc_b');
    expect(result.current.location.search).toBe('');
    expect(keys).toHaveLength(2);
  });

  it('keeps the thread creator that replaces the shown thread', async () => {
    const { result } = mount('/agent/agt_1/tpc_a?portalThread=thd_a');
    await waitFor(() => expect(useChatStore.getState().showPortal).toBe(true));

    await act(async () => {
      useChatStore.getState().openThreadCreator('msg_1');
    });

    await waitFor(() => expect(result.current.location.search).toBe(''));
    expect(useChatStore.getState().showPortal).toBe(true);
    expect(useChatStore.getState().portalStack).toEqual([
      { startMessageId: 'msg_1', type: PortalViewType.Thread },
    ]);
  });

  it('still writes the param when the store opens or closes the pane', async () => {
    const { result } = mount('/agent/agt_1/tpc_a');

    await act(async () => {
      useChatStore.getState().openThreadInPortal('thd_a');
    });
    await waitFor(() => expect(result.current.location.search).toBe('?portalThread=thd_a'));

    await act(async () => {
      useChatStore.getState().closeThreadPortal();
    });
    await waitFor(() => expect(result.current.location.search).toBe(''));
  });

  describe('topic switch in the store', () => {
    const openOnTopicA = async (threadMaps: Record<string, { id: string }[]>) => {
      useChatStore.setState({ activeTopicId: 'tpc_a', threadMaps: threadMaps as any }, false);
      const mounted = mount('/agent/agt_1/tpc_a?portalThread=thd_a');
      await waitFor(() => expect(useChatStore.getState().showPortal).toBe(true));
      await waitFor(() => expect(useChatStore.getState().portalThreadId).toBe('thd_a'));
      return mounted;
    };

    /** @example T-2769: B's first frame must not show A's subtopic pane (no wait for the URL). */
    it("closes another topic's pane in the same tick, without navigating", async () => {
      const { keys } = await openOnTopicA({ tpc_a: [{ id: 'thd_a' }] });

      act(() => {
        useChatStore.setState({ activeTopicId: 'tpc_b' }, false);
        // Read before React or the router get a turn: the switch itself closed it.
        expect(useChatStore.getState().showPortal).toBe(false);
        expect(useChatStore.getState().portalStack).toEqual([]);
        expect(useChatStore.getState().portalThreadId).toBeUndefined();
      });

      // The route sync owns the URL of a topic switch; the hook must not write it.
      expect(keys).toHaveLength(1);
    });

    it('keeps a deep-linked thread no loaded list knows yet', async () => {
      await openOnTopicA({ tpc_a: [{ id: 'thd_other' }] });

      act(() => {
        useChatStore.setState({ activeTopicId: 'tpc_b' }, false);
      });

      expect(useChatStore.getState().showPortal).toBe(true);
      expect(useChatStore.getState().portalThreadId).toBe('thd_a');
    });

    it('keeps a non-thread view whose panel synced a thread of the old topic', async () => {
      useChatStore.setState(
        { activeTopicId: 'tpc_a', threadMaps: { tpc_a: [{ id: 'thd_a' }] } as any },
        false,
      );
      mount('/agent/agt_1/tpc_a');
      await act(async () => {
        useChatStore
          .getState()
          .pushPortalView({ documentId: 'doc_1', type: PortalViewType.Document });
        // The Document panel's chat binds its thread without pushing a Thread view.
        useChatStore.getState().syncThreadInPortal('thd_a');
      });

      act(() => {
        useChatStore.setState({ activeTopicId: 'tpc_b' }, false);
      });

      expect(useChatStore.getState().portalStack).toEqual([
        { documentId: 'doc_1', type: PortalViewType.Document },
      ]);
    });

    it('keeps the thread creator open across a topic switch', async () => {
      await openOnTopicA({ tpc_a: [{ id: 'thd_a' }] });
      await act(async () => {
        useChatStore.getState().openThreadCreator('msg_1');
      });

      act(() => {
        useChatStore.setState({ activeTopicId: 'tpc_b' }, false);
      });

      expect(useChatStore.getState().portalStack).toEqual([
        { startMessageId: 'msg_1', type: PortalViewType.Thread },
      ]);
    });
  });
});
