'use client';

import { type UIChatMessage } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useUserAvatar } from '@/hooks/useUserAvatar';

import { useAgentMeta } from '../../hooks';
import ContentBlock from '../AssistantGroup/components/ContentBlock';
import UserMessageContent from '../User/components/MessageContent';

interface CompressedMessageItemProps {
  message: UIChatMessage;
}

/**
 * Renders a single message within a compressed group
 * Reuses existing User and Assistant content components for consistency
 */
const CompressedMessageItem = memo<CompressedMessageItemProps>(({ message }) => {
  const userAvatar = useUserAvatar();
  const agentAvatar = useAgentMeta(message.agentId);
  const { role, children } = message;

  // Render user message
  if (role === 'user') {
    return (
      <Flexbox horizontal gap={8} paddingBlock={4}>
        <Avatar avatar={userAvatar} size={28} />
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
        <Avatar {...agentAvatar} size={28} />
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
        <Avatar {...agentAvatar} size={28} />
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
