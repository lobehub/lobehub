import type { ChannelListItem } from '@lobechat/types';

/**
 * The Channels one sidebar lists: a project's own, or (without a project) those outside every
 * project, so each Channel appears in exactly one place. A 1:1 conversation is left out, whether
 * with an Agent (it opens from the Agent's row) or with another person: neither is a group
 * Channel.
 */
export const channelsInScope = <
  T extends Pick<ChannelListItem, 'agentId' | 'peerUserId' | 'projectId'>,
>(
  channels: T[] | undefined,
  projectId?: string,
): T[] | undefined =>
  channels?.filter(
    (channel) =>
      !channel.agentId &&
      !channel.peerUserId &&
      (projectId ? channel.projectId === projectId : !channel.projectId),
  );
