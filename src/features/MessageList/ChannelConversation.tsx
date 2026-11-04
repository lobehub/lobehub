'use client';

import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelListItem } from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { HashIcon } from 'lucide-react';
import { memo } from 'react';

import { useChannelMenu } from '@/features/Channels/useChannelMenu';

import ConversationRow from './ConversationRow';
import { channelPreview } from './conversations';
import { AVATAR_SIZE } from './style';

interface ChannelConversationProps {
  active: boolean;
  activeAt: Date;
  channel: ChannelListItem;
}

/** A group Channel as one more conversation, ordered with the Agents by its latest message. */
const ChannelConversation = memo<ChannelConversationProps>(({ active, activeAt, channel }) => {
  const menuItems = useChannelMenu();

  return (
    <ConversationRow
      active={active}
      activeAt={activeAt}
      contextMenuItems={menuItems(channel)}
      preview={channelPreview(channel)}
      title={channel.title}
      unread={channel.unreadCount}
      url={CHANNEL_URL(channel.id)}
      avatar={
        <Avatar
          avatar={<Icon color={cssVar.colorTextSecondary} icon={HashIcon} size={16} />}
          background={cssVar.colorFillSecondary}
          shape={'square'}
          size={AVATAR_SIZE}
        />
      }
    />
  );
});

ChannelConversation.displayName = 'ChannelConversation';

export default ChannelConversation;
