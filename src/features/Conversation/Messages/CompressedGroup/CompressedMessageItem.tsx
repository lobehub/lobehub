'use client';

import { agentDisplayName, type UIChatMessage } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useUserAvatar } from '@/hooks/useUserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useAgentMeta } from '../../hooks';
import ContentBlock from '../AssistantGroup/components/ContentBlock';
import UserMessageContent from '../User/components/MessageContent';
import { resolveSenderIdentity } from '../User/resolveSenderIdentity';

interface CompressedMessageItemProps {
  message: UIChatMessage;
}

/**
 * Renders a single message within a compressed group
 * Reuses existing User and Assistant content components for consistency
 */
const CompressedMessageItem = memo<CompressedMessageItemProps>(({ message }) => {
  const { t } = useTranslation('chat');
  const userAvatar = useUserAvatar();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const agentAvatar = useAgentMeta(message.agentId);
  const { role, children, sender } = message;

  // Render user message
  if (role === 'user') {
    // A shared (workspace) topic's compressed history may hold messages from
    // other members — render the sender's identity, not the viewer's.
    const { avatar, title } = resolveSenderIdentity({
      currentUserId,
      selfAvatar: userAvatar,
      sender,
      unknownLabel: t('sender.unknownMember'),
    });
    return (
      <Flexbox horizontal gap={8} paddingBlock={4}>
        <Avatar avatar={avatar} name={title} size={28} title={title || undefined} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <UserMessageContent {...message} />
        </Flexbox>
      </Flexbox>
    );
  }

  // Render assistant message (standalone without tools)
  if (role === 'assistant') {
    return (
      <Flexbox horizontal gap={8} paddingBlock={4}>
        <Avatar {...agentAvatar} name={agentDisplayName(agentAvatar)} size={28} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ContentBlock
            disableEditing
            assistantId={message.id}
            content={message.content}
            id={message.id}
          />
        </Flexbox>
      </Flexbox>
    );
  }

  // Render assistantGroup (assistant message with tool calls)
  if (role === 'assistantGroup' && children) {
    return (
      <Flexbox horizontal gap={8} paddingBlock={4}>
        <Avatar {...agentAvatar} name={agentDisplayName(agentAvatar)} size={28} />
        <Flexbox flex={1} gap={8} style={{ overflow: 'hidden' }}>
          {children.map((block) => (
            <ContentBlock {...block} disableEditing assistantId={message.id} key={block.id} />
          ))}
        </Flexbox>
      </Flexbox>
    );
  }

  // Skip other roles (tool, system, etc.)
  return null;
});

CompressedMessageItem.displayName = 'CompressedMessageItem';

export default CompressedMessageItem;
