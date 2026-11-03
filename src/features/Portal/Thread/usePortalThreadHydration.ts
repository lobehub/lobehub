import { useEffect, useLayoutEffect, useRef } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { PORTAL_THREAD_QUERY_KEY } from './sharePath';

const useStoreUpdater = createStoreUpdater(useChatStore);

/**
 * Two-way binding between `?portalThread=` and the side panel's thread, shared
 * by the agent and group conversation routes. The URL leads: a navigation that
 * sets the param opens the pane and one that drops it (a topic switch, "open in
 * main", Back) closes it.
 */
export const usePortalThreadHydration = () => {
  const [portalThread, setThread] = useQueryState(PORTAL_THREAD_QUERY_KEY);
  useStoreUpdater('portalThreadId', portalThread!);

  // The param this render was given: the store following a navigation must not
  // write it again — that write would be built from this render's query and
  // undo the navigation.
  const portalThreadRef = useRef(portalThread);
  portalThreadRef.current = portalThread;

  useLayoutEffect(() => {
    // Set while a topic switch closes the pane: the topic's own navigation
    // already drops `?portalThread=`, so this close must not navigate again.
    let closingForTopicSwitch = false;

    const unsubscribeThread = useChatStore.subscribe(
      (s) => s.portalThreadId,
      (state) => {
        if (closingForTopicSwitch) return;
        if ((state || null) === (portalThreadRef.current || null)) return;
        setThread(state || null);
      },
    );

    // Close another topic's thread in the switch itself, so the new topic's
    // first render has no pane; waiting for the URL leaves a skeleton frame.
    const unsubscribeTopic = useChatStore.subscribe(
      (s) => s.activeTopicId,
      (topicId) => {
        const state = useChatStore.getState();
        // Only a pane showing a thread: a creator (no thread yet) or another view
        // on top, such as a document bound to a thread, stays.
        if (!portalThreadSelectors.currentThreadView(state)?.threadId) return;
        if (portalThreadSelectors.isPortalThreadKeptOnTopic(topicId)(state)) return;

        closingForTopicSwitch = true;
        try {
          state.closeThreadPortal();
        } finally {
          closingForTopicSwitch = false;
        }
      },
    );

    return () => {
      unsubscribeThread();
      unsubscribeTopic();
    };
  }, [setThread]);

  const previousPortalThreadRef = useRef(portalThread);
  useEffect(() => {
    const previous = previousPortalThreadRef.current;
    previousPortalThreadRef.current = portalThread;
    const state = useChatStore.getState();

    if (portalThread) {
      if (!state.showPortal)
        state.pushPortalView({ threadId: portalThread, type: PortalViewType.Thread });
      return;
    }

    // Close the pane that showed the dropped thread rather than leave it open and
    // empty. Only that thread: opening the thread creator also drops the param,
    // and the creator it puts in the pane must stay.
    if (previous && portalThreadSelectors.currentThreadView(state)?.threadId === previous)
      state.closeThreadPortal();
  }, [portalThread]);
};
