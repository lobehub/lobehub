import { AGENT_CHAT_URL, DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { memo } from 'react';
import { Link } from 'react-router';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import ListItem from '../ListItem';

const Inbox = memo(() => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const isInboxActive = useSessionStore(sessionSelectors.isInboxSession);
  const navigateToAgent = useNavigateToAgent();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxRouteAgentId = resolveInboxAgentRouteId(inboxAgentId);

  return (
    <Link
      aria-label={DEFAULT_INBOX_TITLE}
      to={AGENT_CHAT_URL(inboxRouteAgentId, mobile)}
      onClick={(e) => {
        e.preventDefault();
        navigateToAgent(inboxRouteAgentId);
      }}
    >
      <ListItem
        active={isInboxActive}
        avatar={DEFAULT_INBOX_AVATAR}
        key={'inbox'}
        title={DEFAULT_INBOX_TITLE}
        styles={{
          container: {
            gap: 12,
          },
          content: {
            gap: 6,
            maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
          },
        }}
      />
    </Link>
  );
});

export default Inbox;
