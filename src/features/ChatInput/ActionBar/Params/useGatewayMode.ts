import { useState } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

export const useGatewayMode = () => {
  const agentId = useAgentId();
  const { canConfigureResource } = useChatInputResourceAccess();
  const serverEnabled = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const defaultDisabled = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode,
  );
  const agentDisabled = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).disableGatewayMode,
  );
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [loading, setLoading] = useState(false);
  const available = Boolean(agentId && serverEnabled && canConfigureResource);

  const onChange = async (enabled: boolean) => {
    if (!available) return;
    setLoading(true);
    try {
      await updateAgentChatConfig({ disableGatewayMode: !enabled });
    } finally {
      setLoading(false);
    }
  };

  return {
    available,
    enabled: (agentDisabled ?? defaultDisabled) !== true,
    loading,
    onChange,
  };
};
