import type { LobeAgentChatConfig, WorkspaceUserPreference } from '@lobechat/types';

type WorkspaceMemberChatOverrides = Pick<LobeAgentChatConfig, 'contextMode' | 'enableAgentMode'>;

export const getWorkspaceMemberChatOverrides = (
  preference: WorkspaceUserPreference,
  agentId: string,
): WorkspaceMemberChatOverrides => {
  const contextMode = preference.agentContextModeOverrides?.[agentId];
  const enableAgentMode = preference.agentModeOverrides?.[agentId];

  return {
    ...(contextMode === undefined ? {} : { contextMode }),
    ...(enableAgentMode === undefined ? {} : { enableAgentMode }),
  };
};
