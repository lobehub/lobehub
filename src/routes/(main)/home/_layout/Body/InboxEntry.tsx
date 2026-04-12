'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { isModifierClick } from '@/utils/navigation';

const InboxEntry = memo(() => {
  const navigate = useNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId!));
  const isLoading = useChatStore(operationSelectors.isAgentRuntimeRunning);

  const title = inboxMeta.title || 'Lobe AI';
  const avatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const url = SESSION_CHAT_URL(inboxAgentId, false);

  return (
    <Link
      aria-label={title}
      to={url}
      onClick={(e) => {
        if (isModifierClick(e)) return;
        e.preventDefault();
        navigate(url);
      }}
    >
      <NavItem
        loading={isLoading}
        title={title}
        icon={<Avatar emojiScaleWithBackground avatar={avatar} shape={'square'} size={24} />}
      />
    </Link>
  );
});

export default InboxEntry;
