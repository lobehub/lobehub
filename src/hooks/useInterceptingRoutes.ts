import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { ChatSettingsTabs } from '@/store/global/initialState';

export const useOpenChatSettings = (tab: ChatSettingsTabs = ChatSettingsTabs.Meta) => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();

  return useMemo(() => {
    if (isMobile)
      return () => navigate(`/chat/settings?session=${activeAgentId}&showMobileWorkspace=true`);

    return () => {
      useAgentStore.setState({ showAgentSetting: true });
    };
  }, [activeAgentId, navigate, location.pathname, tab, isMobile]);
};
