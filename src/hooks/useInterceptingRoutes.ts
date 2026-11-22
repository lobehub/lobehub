import { useCallback } from 'react';

import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { isMobileSurface } from '@/utils/mobileSurface';

export const useOpenChatSettings = () => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(() => {
    if (!activeAgentId) return;

    // The mobile bundle keeps its own settings screen.
    navigate(
      isMobileSurface()
        ? `/agent/${activeAgentId}/settings?showMobileWorkspace=true`
        : buildAgentProfileTabPath(activeAgentId, 'opening'),
    );
  }, [activeAgentId, navigate]);
};
