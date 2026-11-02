import type { AgentContextMode, AgentItem, LobeAgentChatConfig } from '@lobechat/types';

import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

interface EffectiveAgentModePreferenceSources {
  agent?: Pick<Partial<AgentItem>, 'userId' | 'visibility' | 'workspaceId'>;
  currentUserId?: string;
  memberContextModeOverride?: AgentContextMode;
  memberModeOverride?: boolean;
  sharedContextMode?: AgentContextMode;
  sharedEnableAgentMode: boolean;
  sharedPromptMode?: 'full' | 'lean';
  sharedToolMode?: LobeAgentChatConfig['toolMode'];
}

const resolveEffectiveAgentModePreference = ({
  agent,
  currentUserId,
  memberContextModeOverride,
  memberModeOverride,
  sharedContextMode,
  sharedEnableAgentMode,
  sharedPromptMode,
  sharedToolMode,
}: EffectiveAgentModePreferenceSources) => {
  const isAuthor = !!currentUserId && agent?.userId === currentUserId;
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !isAuthor;

  if (!usesWorkspaceMemberMode) {
    return {
      contextMode: sharedContextMode,
      enableAgentMode: sharedEnableAgentMode,
      promptMode: sharedPromptMode,
      toolMode: sharedToolMode,
    };
  }

  return {
    contextMode: memberContextModeOverride ?? sharedContextMode,
    enableAgentMode: memberModeOverride ?? sharedEnableAgentMode,
    promptMode: sharedPromptMode,
    toolMode: sharedToolMode,
  };
};

export const useEffectiveAgentModePreference = (agentId: string) => {
  const [agent, sharedEnableAgentMode, sharedContextMode, sharedPromptMode, sharedToolMode] =
    useAgentStore((state) => [
      agentByIdSelectors.getAgentById(agentId)(state),
      agentByIdSelectors.getAgentEnableModeById(agentId)(state),
      chatConfigByIdSelectors.getContextModeById(agentId)(state),
      agentByIdSelectors.getAgentPromptModeById(agentId)(state),
      chatConfigByIdSelectors.getChatConfigById(agentId)(state).toolMode,
    ]);
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const storePreference = useUserStore((state) => state.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (state) => state.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});

  return {
    ...resolveEffectiveAgentModePreference({
      agent,
      memberContextModeOverride: usesWorkspaceMemberMode
        ? preference.agentContextModeOverrides?.[agentId]
        : undefined,
      memberModeOverride: usesWorkspaceMemberMode
        ? preference.agentModeOverrides?.[agentId]
        : undefined,
      sharedContextMode,
      sharedEnableAgentMode,
      sharedPromptMode,
      sharedToolMode,
    }),
    isPreferenceLoading: isAccessLoading || (usesWorkspaceMemberMode && isLoading),
    usesWorkspaceMemberMode,
  };
};

export { resolveEffectiveAgentModePreference };
