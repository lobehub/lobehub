import type { ChannelListItem } from '@lobechat/types';
import { type DropdownItem } from '@lobehub/ui';
import { useCallback } from 'react';

import { directAvatarState, replyAvatarState } from '@/features/Channels/jobStatus';
import { useChannelMenu } from '@/features/Channels/useChannelMenu';
import { channelSelectors, useChannelStore } from '@/store/channel';

/** The direct Channel's own conversation action, next to the Agent's own menu. */
const CONVERSATION_ACTION_KEYS = new Set(['unarchive']);

/**
 * A direct Channel is the chat with one Agent, so it cannot be archived or trashed. The row only
 * frees one that was archived earlier. Keys are prefixed so they cannot collide with the Agent's
 * own menu.
 */
export const conversationActions = (menu: DropdownItem[]): DropdownItem[] =>
  menu.flatMap((item) => {
    if (!item || !('key' in item)) return [];
    const key = String(item.key);
    if (!CONVERSATION_ACTION_KEYS.has(key)) return [];
    return [{ ...item, key: `channel-${key}` } as DropdownItem];
  });

/** What an Agent row takes from the direct Channel it opens. */
export const useDirectChannelRow = (channel: ChannelListItem | undefined, active: boolean) => {
  const channelMenu = useChannelMenu();
  // A direct Channel replies through Channel jobs, not chat operations. The open conversation's
  // view is polled while it works, so it is fresher than the list; any other cached view may be
  // stale, so other rows read the jobs the list carries.
  const replyState = useChannelStore((s) => {
    if (!channel) return;
    const detail = active
      ? channelSelectors.detail({ channelId: channel.id, threadId: null })(s)
      : undefined;
    return detail ? directAvatarState(detail) : replyAvatarState(channel.replyJobs ?? []);
  });
  const channelActions = useCallback(
    () => (channel ? conversationActions(channelMenu(channel)) : []),
    [channel, channelMenu],
  );

  return { channelActions, replyState };
};
