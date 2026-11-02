'use client';

import { useCallback } from 'react';

import { useBusinessCanEnableAgentMode } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import { useAgentId } from './useAgentId';
import { type ChatInputMode, resolveModeFlags } from './useEffectiveAgentMode';
import { useUpdateAgentConfig } from './useUpdateAgentConfig';

export { resolveModeFlags };

/**
 * Select chat, agent, or the opt-in on-demand mode.
 *
 * The flag is stored on `chatConfig.enableAgentMode` so it persists (chat_config
 * is a jsonb column) and is readable on the server. The `plugins` array is left
 * untouched — chat mode is enforced at the runtime tools engine layer.
 */
export const useToggleAgentMode = () => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const canEnableBusinessAgentMode = useBusinessCanEnableAgentMode(agentId);
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  return useCallback(
    async (mode: ChatInputMode) => {
      if (isAccessLoading) return;

      const { contextMode, enableAgentMode, promptMode } = resolveModeFlags(mode);
      const effectiveEnableAgentMode = enableAgentMode && canEnableBusinessAgentMode;
      const effectiveContextMode =
        effectiveEnableAgentMode && contextMode === 'on-demand' ? 'on-demand' : 'default';
      if (usesWorkspaceMemberMode) {
        await updateWorkspaceUserPreference({
          agentContextModeOverrides: { [agentId]: effectiveContextMode },
          agentModeOverrides: { [agentId]: effectiveEnableAgentMode },
        });
        return;
      }

      await updateAgentChatConfig({
        contextMode: effectiveContextMode,
        enableAgentMode: effectiveEnableAgentMode,
        promptMode,
      });
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
