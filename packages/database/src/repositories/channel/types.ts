import type { ChannelMemberRole } from '@lobechat/types';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';

export interface ChannelAccess {
  channel: ChannelItem;
  /** The caller's own human member row. */
  member: ChannelMemberItem;
}

export interface ChannelWriteOptions {
  /** Lets a write through while the channel is archived; archived channels are read-only. */
  allowArchived?: boolean;
  /** Lets owners and admins act on a channel that sits in the recycle bin. */
  allowTrashed?: boolean;
  minRole?: ChannelMemberRole;
}

/** A conversation between two of the caller's Agents, with their active Agent members. */
export interface ChannelAgentPairAccess extends ChannelAccess {
  agents: ChannelMemberItem[];
}

/** `channels.agentPairKey`: the same for either Agent asking. */
export const channelAgentPairKey = (agentId: string, otherAgentId: string) => {
  if (agentId === otherAgentId) throw new Error('A conversation between Agents needs two Agents');
  return [agentId, otherAgentId].sort().join(':');
};
