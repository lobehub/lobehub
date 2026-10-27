import type { ChannelMemberRole } from '@lobechat/types';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';

export interface ChannelAccess {
  channel: ChannelItem;
  /** The caller's own human member row. */
  member: ChannelMemberItem;
}

export interface ChannelWriteOptions {
  /** Lets owners and admins un-archive or clean up an archived channel. */
  allowArchived?: boolean;
  minRole?: ChannelMemberRole;
}
