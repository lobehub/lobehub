'use client';

import { useCallback } from 'react';

import { useBusinessCanEnableAgentMode } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useAgentData } from '@/store/agent/projection';
import { useUserStore } from '@/store/user';

import { useAgentId } from './useAgentId';
import { useUpdateAgentConfig } from './useUpdateAgentConfig';

/**
 * Toggle between chat mode and agent mode.
 *
 * The flag is stored on `chatConfig.enableAgentMode` so it persists (chat_config
 * is a jsonb column) and is readable on the server. The `plugins` array is left
 * untouched — chat mode is enforced at the runtime tools engine layer.
 */
export const useToggleAgentMode = () => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const canEnableBusinessAgentMode = useBusinessCanEnableAgentMode(agentId);
  const agent = useAgentData(agentId);
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  return useCallback(
    async (enable: boolean) => {
      if (isAccessLoading) return;

      const enableAgentMode = enable && canEnableBusinessAgentMode;
      if (usesWorkspaceMemberMode) {
        await updateWorkspaceUserPreference({
          agentModeOverrides: { [agentId]: enableAgentMode },
        });
        return;
      }

      await updateAgentChatConfig({ enableAgentMode });
    },
    [
      agentId,
      canEnableBusinessAgentMode,
      isAccessLoading,
      updateAgentChatConfig,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberMode,
    ],
  );
};
