import { type AgentContextMode, resolveContextMode, resolveToolMode } from '@lobechat/types';

import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useEffectiveAgentModePreference } from './effectiveAgentModePreference';
import { useEffectiveModel } from './useEffectiveModel';

export type ChatInputMode = 'agent' | 'chat' | 'on-demand';

interface ModeFlags {
  contextMode: AgentContextMode;
  enableAgentMode: boolean;
  promptMode: 'full' | 'lean';
}

/**
 * Map the explicit UI mode to the persisted agent flags. Selecting either
 * legacy mode writes `contextMode: 'default'`; only the third option opts into
 * on-demand loading.
 */
export const resolveModeFlags = (mode: ChatInputMode): ModeFlags => {
  switch (mode) {
    case 'on-demand': {
      return { contextMode: 'on-demand', enableAgentMode: true, promptMode: 'full' };
    }
    case 'agent': {
      return { contextMode: 'default', enableAgentMode: true, promptMode: 'full' };
    }
    default: {
      return { contextMode: 'default', enableAgentMode: false, promptMode: 'full' };
    }
  }
};

interface ResolveEffectiveAgentModeParams {
  contextMode?: AgentContextMode;
  enableAgentMode: boolean;
  /**
   * Whether the aiProvider runtime-state (the enabled-model list + abilities)
   * has finished loading. Defaults to `true` so callers that don't track it keep
   * the prior behaviour.
   */
  isModelListReady?: boolean;
  supportToolUse: boolean;
  toolMode?: 'agent' | 'chat' | 'custom';
}

export const resolveEffectiveAgentMode = ({
  contextMode,
  enableAgentMode,
  isModelListReady = true,
  supportToolUse,
  toolMode,
}: ResolveEffectiveAgentModeParams) => {
  // While the model list is not ready, `supportToolUse` is `false` only because
  // the model hasn't hydrated into the store yet — not because it lacks tool
  // calling. Downgrading to chat mode on that transient unknown would drop tools
  // and flash the mode pill to "chat" on first paint. Assume tool use is
  // available while loading and honour the user's stored intent; the real
  // capability re-evaluates once the list loads.
  const effectiveSupportToolUse = isModelListReady ? supportToolUse : true;
  const resolvedToolMode = resolveToolMode({ enableAgentMode, toolMode });
  const resolvedContextMode = resolveContextMode(
    { contextMode, enableAgentMode, toolMode },
    { supportToolUse: effectiveSupportToolUse },
  );
  const currentMode: ChatInputMode =
    resolvedToolMode !== 'chat' && effectiveSupportToolUse
      ? resolvedContextMode === 'on-demand'
        ? 'on-demand'
        : 'agent'
      : 'chat';

  return {
    canSelectAgentMode: effectiveSupportToolUse,
    canSelectOnDemandMode:
      effectiveSupportToolUse && (toolMode === undefined || toolMode === 'agent'),
    currentMode,
    isAgentModeUnavailable:
      (resolvedToolMode !== 'chat' || contextMode === 'on-demand') && !effectiveSupportToolUse,
    isAgentRuntimeMode: currentMode === 'agent' || currentMode === 'on-demand',
    supportToolUse: effectiveSupportToolUse,
  };
};

interface ModelAndProvider {
  model: string;
  provider: string;
}

const useAgentModeForModel = (agentId: string, { model, provider }: ModelAndProvider) => {
  const { contextMode, enableAgentMode, isPreferenceLoading, toolMode, usesWorkspaceMemberMode } =
    useEffectiveAgentModePreference(agentId);
  const supportToolUse = useModelSupportToolUse(model, provider);
  const isModelListReady = useAiInfraStore(aiProviderSelectors.isInitAiProviderRuntimeState);

  return {
    ...resolveEffectiveAgentMode({
      contextMode,
      enableAgentMode,
      isModelListReady,
      supportToolUse,
      toolMode,
    }),
    isPreferenceLoading,
    usesWorkspaceMemberMode,
  };
};

/**
 * Agent mode for a chat composer: judged by the model that will actually run —
 * the active topic's pinned model, otherwise the agent default
 * (see `useEffectiveModel`).
 */
export const useEffectiveAgentMode = (agentId: string) =>
  useAgentModeForModel(agentId, useEffectiveModel(agentId));

/**
 * Agent mode judged by the agent's own default model only. For surfaces that
 * have no topic context (e.g. task execution settings, which target an assignee
 * agent) and must not follow whatever topic the chat page currently has active.
 */
export const useAgentDefaultModelAgentMode = (agentId: string) => {
  const [model, provider] = useAgentStore((state) => [
    agentByIdSelectors.getAgentModelById(agentId)(state),
    agentByIdSelectors.getAgentModelProviderById(agentId)(state),
  ]);

  return useAgentModeForModel(agentId, { model, provider });
};
