import { type ReactNode } from 'react';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

import AgentChat from './AgentChat';
import AgentModal from './AgentModal';
import AgentOpening from './AgentOpening';

export interface AgentSettingsContentProps {
  loadingSkeleton: ReactNode;
  tab: ChatSettingsTabs;
}

const AgentSettingsContent = memo<AgentSettingsContentProps>(({ tab, loadingSkeleton }) => {
  const loading = useAgentStore(agentSelectors.isAgentConfigLoading);

  if (loading) return loadingSkeleton;

  return (
    <>
      {tab === ChatSettingsTabs.Opening && <AgentOpening />}
      {tab === ChatSettingsTabs.Chat && <AgentChat />}
      {tab === ChatSettingsTabs.Modal && <AgentModal />}
    </>
  );
});

export default AgentSettingsContent;
