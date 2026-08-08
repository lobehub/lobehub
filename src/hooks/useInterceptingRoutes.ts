import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { openAgentSettingsModal } from '@/routes/(main)/agent/profile/features/AgentSettings';
import { useAgentStore } from '@/store/agent';
import { ChatSettingsTabs } from '@/store/global/initialState';

export const useOpenChatSettings = (tab: ChatSettingsTabs = ChatSettingsTabs.Opening) => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const isMobile = useIsMobile();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();

  return useMemo(() => {
    if (isMobile)
      return () => navigate(`/agent/${activeAgentId}/settings?showMobileWorkspace=true`);

    return () => {
      openAgentSettingsModal();
    };
  }, [activeAgentId, navigate, location.pathname, tab, isMobile]);
};
