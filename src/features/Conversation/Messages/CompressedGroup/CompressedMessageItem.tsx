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
import Group from '../AssistantGroup/components/Group';
import UserMessageContent from '../User/components/MessageContent';
import { getBotSender, resolveSenderIdentity } from '../User/resolveSenderIdentity';
import { resolveCompressedMessageView } from './resolveCompressedMessageView';

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
  const { children, sender } = message;
  const view = resolveCompressedMessageView(message);

  // Render user message
  if (view === 'user') {
    // A shared (workspace) topic's compressed history may hold messages from
    // other members — render the sender's identity, not the viewer's. The
    // resolver reads the server-written blocks off the row itself, so this path
    // cannot drop one of them (an agent → agent turn used to revert to the human
    // owner here).
    const { avatar, title } = resolveSenderIdentity({
      currentUserId,
      message,
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
  if (view === 'assistant-content') {
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

  // Render a turn that used tools through the same chain renderer as the live
  // conversation, so its process (reasoning + tool calls + intermediate prose)
  // folds under the same turn-process header ("共运行 {n} 步") instead of
  // expanding every step.
  if (view === 'assistant-turn-chain') {
    return (
      <Flexbox horizontal gap={8} paddingBlock={4}>
        <Avatar {...agentAvatar} name={agentDisplayName(agentAvatar)} size={28} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <Group
            disableEditing
            enableProcessFold
            blocks={children ?? []}
            id={message.id}
            // Compressed history is never the conversation's live tail, so it
            // must not wait for the latest turn's "final answer exists" guard.
            isLatestItem={false}
            // Only feeds the (disabled) edit affordance.
            messageIndex={0}
          />
        </Flexbox>
      </Flexbox>
    );
  }

  // Skip other roles (tool, system, etc.)
  return null;
});

CompressedMessageItem.displayName = 'CompressedMessageItem';

export default CompressedMessageItem;
