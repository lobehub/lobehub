import { AGENT_CHAT_URL } from '@lobechat/const';
import { memo } from 'react';

import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import ListItem from '../ListItem';

const Inbox = memo(() => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const navigateToAgent = useNavigateToAgent();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxRouteAgentId = resolveInboxAgentRouteId(inboxAgentId);

  const isInboxActive = useAgentStore((s) => s.activeAgentId === inboxAgentId);
  const title = useAgentStore(agentSelectors.inboxAgentDisplayName);
  const avatar = useAgentStore(agentSelectors.inboxAgentAvatar);

  return (
    <WorkspaceLink
      aria-label={title}
      to={AGENT_CHAT_URL(inboxRouteAgentId, mobile)}
      onClick={(e) => {
        e.preventDefault();
        navigateToAgent(inboxRouteAgentId);
      }}
    >
      <ListItem
        active={isInboxActive}
        avatar={avatar}
        key={'inbox'}
        title={title}
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
    </WorkspaceLink>
  );
});

export default Inbox;
