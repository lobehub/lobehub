import type { ChannelPublicMessage } from '@lobechat/types';
import { useLatest } from 'ahooks';
import { useEffect, useRef } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';

/**
 * A reply to an Agent sent from the main conversation is stored in a thread and leaves this
 * feed, whether it sent at once or on retry. Opens that thread unless the user has moved on:
 * left the conversation, switched identity, or the view unmounted. A conversation covered by a
 * thread page (`covered`) keeps sending, but must not pull the page away when the send lands.
 */
export const useFollowSent = (
  threadId: string | null,
  onOpenThread?: (threadId: string, toggle?: boolean) => void,
  covered = false,
) => {
  const mounted = useRef(false);
  const location = useLatest(useActiveLocation());
  const openThread = useLatest(onOpenThread);
  const coveredNow = useLatest(covered);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (send: Promise<Pick<ChannelPublicMessage, 'threadId'> | undefined>) => {
    const sentLocation = location.current;
    const sentScope = cacheScope.get();
    void send.then((stored) => {
      if (coveredNow.current) return;
      if (
        stored?.threadId &&
        !threadId &&
        mounted.current &&
        sentScope === cacheScope.get() &&
        sentLocation.pathname === location.current.pathname &&
        sentLocation.search === location.current.search
      )
        openThread.current?.(stored.threadId, false);
    });
  };
};
