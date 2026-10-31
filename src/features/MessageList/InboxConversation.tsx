'use client';

import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { usePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import ConversationRow from './ConversationRow';
import { AVATAR_SIZE } from './style';

/** The built-in Lobe AI conversation, always first in the list. */
const InboxConversation = memo<{ activeRouteId?: string; preview?: string }>(
  ({ activeRouteId, preview }) => {
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const routeId = resolveInboxAgentRouteId(inboxAgentId);
    const meta = useAgentStore(agentSelectors.getAgentMetaById(routeId));
    const running = useChatStore(
      inboxAgentId ? operationSelectors.isAgentVisiblyRunning(inboxAgentId) : () => false,
    );
    const prefetchAgent = usePrefetchAgent();
    const url = usePreservedAgentUrl(routeId);
    const title = agentDisplayName(meta, 'Lobe AI');
    const active = !!activeRouteId && (activeRouteId === routeId || activeRouteId === inboxAgentId);

    return (
      <ConversationRow
        active={active}
        preview={preview || meta.description || undefined}
        running={running}
        title={title}
        url={url}
        avatar={
          <Avatar
            emojiScaleWithBackground
            avatar={meta.avatar || DEFAULT_INBOX_AVATAR}
            shape={'square'}
            size={AVATAR_SIZE}
          />
        }
        onMouseEnter={() => inboxAgentId && prefetchAgent(inboxAgentId)}
      />
    );
  },
);

InboxConversation.displayName = 'InboxConversation';

export default InboxConversation;
