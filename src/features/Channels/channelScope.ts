import type { ChannelListItem } from '@lobechat/types';

/**
 * The Channels one sidebar lists: a project's own, or (without a project) those outside every
 * project, so each Channel appears in exactly one place.
 */
export const channelsInScope = <T extends Pick<ChannelListItem, 'projectId'>>(
  channels: T[] | undefined,
  projectId?: string,
): T[] | undefined =>
  channels?.filter((channel) => (projectId ? channel.projectId === projectId : !channel.projectId));
