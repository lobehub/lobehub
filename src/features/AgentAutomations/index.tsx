'use client';

import { Flexbox } from '@lobehub/ui';
import { useEffect } from 'react';
import urlJoin from 'url-join';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import AutomationList from '@/features/Automations/AutomationList';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * What wakes this agent without the user: the same list as Settings → Automations, narrowed to
 * the agent. Agents create these in conversation, so the page has no create action.
 */
const AgentAutomations = ({ agentId }: { agentId: string }) => {
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useServerConfigStore(serverConfigSelectors.enableWebhook);
  const configLoaded = useServerConfigStore((s) => s.serverConfigLoaded);
  // Until the server config loads, the flag reads as its default, not as the deployment's answer.
  const unavailable = configLoaded && !enabled;

  useEffect(() => {
    if (unavailable) navigate(urlJoin('/agent', agentId, 'profile'), { replace: true });
  }, [agentId, navigate, unavailable]);

  if (unavailable) return null;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={<AgentBreadcrumb agentId={agentId} />}
        // `relative` anchors the absolutely-centered switcher below.
        style={{ position: 'relative' }}
        styles={{
          center: AGENT_PROFILE_TABS_CENTER_STYLE,
          left: { minWidth: 0, paddingInlineStart: 8 },
        }}
      >
        <AgentProfileTabs active={'automations'} agentId={agentId} />
      </NavHeader>
      <Flexbox flex={1} style={{ overflowY: 'auto' }} width={'100%'}>
        <WideScreenContainer>
          <Flexbox paddingBlock={16}>
            <AutomationList agentId={agentId} key={agentId} />
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

export default AgentAutomations;
