import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { ChatSettingsTabs } from '@/store/global/initialState';

export const useOpenChatSettings = (tab: ChatSettingsTabs = ChatSettingsTabs.Opening) => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const isMobile = useIsMobile();
  const navigate = useWorkspaceAwareNavigate();
  const location = useLocation();

  return useMemo(() => {
    if (isMobile)
      return () => navigate(`/chat/settings?session=${activeAgentId}&showMobileWorkspace=true`);

    return () => {
      useAgentStore.setState({ showAgentSetting: true });
    };
  }, [activeAgentId, navigate, location.pathname, tab, isMobile]);
};
