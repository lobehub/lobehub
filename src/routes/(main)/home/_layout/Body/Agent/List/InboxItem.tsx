'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { prefetchRoute } from '@/utils/router';

interface InboxItemProps {
  className?: string;
  style?: CSSProperties;
}

const InboxItem = memo<InboxItemProps>(({ className, style }) => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId!));

  const isLoading = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const prefetchAgent = usePrefetchAgent();
  const inboxAgentTitle = inboxMeta.title || 'Lobe AI';
  const inboxAgentAvatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const inboxUrl = SESSION_CHAT_URL(inboxAgentId, false);

  // Prefetch agent layout chunk and data eagerly since Lobe AI is almost always clicked
  prefetchRoute(inboxUrl);
  prefetchAgent(inboxAgentId!);

  return (
    <Link aria-label={inboxAgentTitle} to={inboxUrl}>
      <NavItem
        className={className}
        loading={isLoading}
        style={style}
        title={inboxAgentTitle}
        icon={
          <Avatar emojiScaleWithBackground avatar={inboxAgentAvatar} shape={'square'} size={24} />
        }
      />
    </Link>
  );
});

export default InboxItem;
