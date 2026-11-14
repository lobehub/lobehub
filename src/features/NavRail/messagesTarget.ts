import { CHANNEL_URL } from '@lobechat/const';
import { memo, useState } from 'react';

import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';

/** Path segments below the active workspace slug, if the pathname carries one. */
const scopedSegments = (pathname: string, activeWorkspaceSlug: string | null) => {
  const segments = pathname.split('/').filter(Boolean);
  return activeWorkspaceSlug && segments[0] === activeWorkspaceSlug ? segments.slice(1) : segments;
};

/**
 * The Channel the Messages tab returns to after `pathname` is visited. Opening a Channel makes it
 * the active one; going back home clears it; any other page keeps the previous one. A project
 * Channel opened from the Projects tab (`/project/:id/channels/:id`) is not tracked.
 */
export const nextActiveChannelId = (
  previous: string | undefined,
  pathname: string,
  activeWorkspaceSlug: string | null,
): string | undefined => {
  const segments = scopedSegments(pathname, activeWorkspaceSlug);
  if (segments.length === 0) return undefined;
  if (segments[0] === 'channels' && segments[1]) return segments[1];
  return previous;
};

/**
 * Keeps the Channel list fresh while the rail points at a Channel, so one removed elsewhere (another
 * tab or device) drops the link back to home instead of opening a missing Channel.
 */
export const ActiveChannelSync = memo(() => {
  channelActions.useFetchList();
  return null;
});

ActiveChannelSync.displayName = 'NavRailActiveChannelSync';

/**
 * Where the Messages tab leads: the active Channel while it still exists, otherwise home, where
 * the conversation list lives.
 */
export const useMessagesUrl = (pathname: string, activeWorkspaceSlug: string | null) => {
  const [tracked, setTracked] = useState(() => ({
    channelId: nextActiveChannelId(undefined, pathname, activeWorkspaceSlug),
    pathname,
  }));
  // Derive on navigation during render rather than in an effect, so the link is never a step behind.
  if (tracked.pathname !== pathname) {
    setTracked({
      channelId: nextActiveChannelId(tracked.channelId, pathname, activeWorkspaceSlug),
      pathname,
    });
  }
  const activeChannelId = tracked.channelId;

  const channelExists = useChannelStore((s) => {
    if (!activeChannelId) return false;
    const list = channelSelectors.list(s);
    // Before the list loads, trust the route the user just opened.
    return !list || list.some((channel) => channel.id === activeChannelId);
  });

  return {
    activeChannelId,
    url: activeChannelId && channelExists ? CHANNEL_URL(activeChannelId) : '/',
  };
};
