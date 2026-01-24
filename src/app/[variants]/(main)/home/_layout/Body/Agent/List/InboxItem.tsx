'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { type CSSProperties, memo } from 'react';
import { Link } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

interface InboxItemProps {
  className?: string;
  style?: CSSProperties;
}

const InboxItem = memo<InboxItemProps>(({ className, style }) => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const isLoading = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const inboxAgentTitle = 'Lobe AI';

  return (
    <Link aria-label={inboxAgentTitle} to={SESSION_CHAT_URL(inboxAgentId, false)}>
      <NavItem
        className={className}
        icon={
          <Avatar
            avatar={DEFAULT_INBOX_AVATAR}
            emojiScaleWithBackground
            shape={'square'}
            size={24}
          />
        }
        loading={isLoading}
        style={style}
        title={inboxAgentTitle}
      />
    </Link>
  );
});

export default InboxItem;
