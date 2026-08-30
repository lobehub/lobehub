import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

import { contextSelectors, useConversationStore } from '../../../store';

/**
 * Get the auto-scroll enabled state for current context
 * Priority: Agent setting > Global setting > Default value (true)
 */
export const useAutoScrollEnabled = (): boolean => {
  const agentId = useConversationStore(contextSelectors.agentId);

  const agentChatConfig = useAgentValue(agentId, agentProjectionSelectors.chatConfig);
  const agentSetting = agentChatConfig?.enableAutoScrollOnStreaming;

  const globalSetting = useUserStore(userGeneralSettingsSelectors.enableAutoScrollOnStreaming);

  // Agent setting takes priority if defined
  if (agentSetting !== undefined) {
    return agentSetting;
  }

  return globalSetting;
};
