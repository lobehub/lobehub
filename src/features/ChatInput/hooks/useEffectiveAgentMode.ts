import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';

export type ChatInputMode = 'agent' | 'chat';

interface ResolveEffectiveAgentModeParams {
  enableAgentMode: boolean;
  /**
   * Whether the aiProvider runtime-state (the enabled-model list + abilities)
   * has finished loading. Defaults to `true` so callers that don't track it keep
   * the prior behaviour.
   */
  isModelListReady?: boolean;
  supportToolUse: boolean;
}

export const resolveEffectiveAgentMode = ({
  enableAgentMode,
  isModelListReady = true,
  supportToolUse,
}: ResolveEffectiveAgentModeParams) => {
  // While the model list is not ready, `supportToolUse` is `false` only because
  // the model hasn't hydrated into the store yet — not because it lacks tool
  // calling. Downgrading to chat mode on that transient unknown would drop tools
  // and flash the mode pill to "chat" on first paint. Assume tool use is
  // available while loading and honour the user's stored intent; the real
  // capability re-evaluates once the list loads.
  const effectiveSupportToolUse = isModelListReady ? supportToolUse : true;

  const currentMode: ChatInputMode = enableAgentMode && effectiveSupportToolUse ? 'agent' : 'chat';
  // Example: stored Agent mode + a model without tool calling should render chat-only runtime UI.
  const isAgentRuntimeMode = currentMode === 'agent';

  return {
    canSelectAgentMode: effectiveSupportToolUse,
    currentMode,
    isAgentModeUnavailable: enableAgentMode && !effectiveSupportToolUse,
    isAgentRuntimeMode,
    supportToolUse: effectiveSupportToolUse,
  };
};

export const useEffectiveAgentMode = (agentId: string) => {
  const [sharedEnableAgentMode, model, provider, agent] = useAgentStore((s) => [
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    agentByIdSelectors.getAgentById(agentId)(s),
  ]);
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const storePreference = useUserStore((s) => s.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (s) => s.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});
  const memberModeOverride = usesWorkspaceMemberMode
    ? preference.agentModeOverrides?.[agentId]
    : undefined;
  const enableAgentMode = memberModeOverride ?? sharedEnableAgentMode;
  const supportToolUse = useModelSupportToolUse(model, provider);
  const isModelListReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);

  return {
    ...resolveEffectiveAgentMode({ enableAgentMode, isModelListReady, supportToolUse }),
    isPreferenceLoading: isAccessLoading || (usesWorkspaceMemberMode && isLoading),
    usesWorkspaceMemberMode,
  };
};
