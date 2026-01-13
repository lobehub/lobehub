'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { type CSSProperties, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isActive = !!inboxAgentId && activeAgentId === inboxAgentId;

  const isLoading = useChatStore(
    useCallback(
      (s) => (isActive ? operationSelectors.isAgentRuntimeRunning(s) : false),
      [isActive],
    ),
  );
  const inboxAgentTitle = 'Lobe AI';

  const handleClick = useCallback(() => {
    if (inboxAgentId) {
      navigate(SESSION_CHAT_URL(inboxAgentId, false));
    }
  }, [inboxAgentId, navigate]);

  return (
    <NavItem
      active={isActive}
      className={className}
      icon={
        <Avatar avatar={DEFAULT_INBOX_AVATAR} emojiScaleWithBackground shape={'square'} size={24} />
      }
      loading={isLoading}
      onClick={handleClick}
      style={style}
      title={inboxAgentTitle}
    />
  );
});

export default InboxItem;
