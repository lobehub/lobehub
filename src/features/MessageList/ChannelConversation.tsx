'use client';

import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelListItem } from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { HashIcon } from 'lucide-react';
import { memo } from 'react';

import { useChannelMenu } from '@/features/Channels/useChannelMenu';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { projectListItemSelector, useProjectStore } from '@/store/project';

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
  // A Channel grouped under a project wears that project's logo; a standalone one keeps "#".
  const project = useProjectStore(projectListItemSelector(channel.projectId));

  return (
    <ConversationRow
      closeOnReselect
      active={active}
      activeAt={activeAt}
      contextMenuItems={menuItems(channel)}
      preview={channelPreview(channel)}
      title={channel.title}
      unread={channel.unreadCount}
      url={CHANNEL_URL(channel.id)}
      avatar={
        project ? (
          <ProjectAvatar
            avatar={project.avatar}
            id={project.id}
            name={project.name}
            size={AVATAR_SIZE}
          />
        ) : (
          <Avatar
            avatar={<Icon color={cssVar.colorTextSecondary} icon={HashIcon} size={16} />}
            background={cssVar.colorFillSecondary}
            shape={'square'}
            size={AVATAR_SIZE}
          />
        )
      }
    />
  );
});

ChannelConversation.displayName = 'ChannelConversation';

export default ChannelConversation;
