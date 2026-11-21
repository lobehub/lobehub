import type { ChannelListItem } from '@lobechat/types';

/**
 * The Channels one sidebar lists: a project's own, or (without a project) those outside every
 * project, so each Channel appears in exactly one place. A direct (1:1 Agent) Channel is left
 * out: it opens from its Agent's row, not as a group Channel.
 */
export const channelsInScope = <T extends Pick<ChannelListItem, 'agentId' | 'projectId'>>(
  channels: T[] | undefined,
  projectId?: string,
): T[] | undefined =>
  channels?.filter(
    (channel) =>
      !channel.agentId && (projectId ? channel.projectId === projectId : !channel.projectId),
  );
