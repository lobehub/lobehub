import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { PORTAL_THREAD_QUERY_KEY } from './sharePath';

/** Query key the conversation routes read for the thread shown in the main area. */
const MAIN_THREAD_QUERY_KEY = 'thread';

/** The thread leaves the side panel and takes over the main area. */
const moveThreadToMainSearch = (search: URLSearchParams, threadId: string) => {
  const next = new URLSearchParams(search);
  next.delete(PORTAL_THREAD_QUERY_KEY);
  next.set(MAIN_THREAD_QUERY_KEY, threadId);

  return next;
};

/** The main area returns to the topic and the thread goes back to the side panel. */
const moveThreadToPortalSearch = (search: URLSearchParams, threadId: string) => {
  const next = new URLSearchParams(search);
  next.delete(MAIN_THREAD_QUERY_KEY);
  next.set(PORTAL_THREAD_QUERY_KEY, threadId);

  return next;
};

/**
 * Moves a thread between the side panel and the main area as ONE pushed history
 * entry; the store follows the URL (route sync for `?thread=`, ThreadHydration
 * for `?portalThread=`). Writing each param from the store instead issues two
 * navigations in one tick, each built from the same stale query, so the later
 * one drops the other's change and Back can't restore the previous layout.
 */
export const useThreadPlacement = () => {
  const [, setSearchParams] = useSearchParams();

  return useMemo(
    () => ({
      backToTopic: (threadId: string) =>
        setSearchParams((prev) => moveThreadToPortalSearch(prev, threadId)),
      openInMain: (threadId: string) =>
        setSearchParams((prev) => moveThreadToMainSearch(prev, threadId)),
    }),
    [setSearchParams],
  );
};
