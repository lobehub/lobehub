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
