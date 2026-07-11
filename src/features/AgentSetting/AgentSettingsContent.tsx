import { type ReactNode } from 'react';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import AgentConnectors from './AgentConnectors';
import AgentGraphRuntime from './AgentGraphRuntime';
import AgentOpening from './AgentOpening';
import AgentSelfIteration from './AgentSelfIteration';

export interface AgentSettingsContentProps {
  loadingSkeleton: ReactNode;
  tab: ChatSettingsTabs;
}

const AgentSettingsContent = memo<AgentSettingsContentProps>(({ tab, loadingSkeleton }) => {
  const loading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
  const enableAgentGraphConfigLab = useUserStore(labPreferSelectors.enableAgentGraphConfig);

  if (loading) return loadingSkeleton;

  return (
    <>
      {tab === ChatSettingsTabs.Opening && <AgentOpening />}
      {enableAgentSelfIteration && tab === ChatSettingsTabs.SelfIteration && <AgentSelfIteration />}
      {enableAgentGraphConfigLab && tab === ChatSettingsTabs.Graph && <AgentGraphRuntime />}
      {tab === ChatSettingsTabs.Connector && <AgentConnectors />}
    </>
  );
});

export default AgentSettingsContent;
