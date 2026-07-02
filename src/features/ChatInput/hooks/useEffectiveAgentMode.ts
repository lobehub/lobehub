import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

export type ChatInputMode = 'agent' | 'chat';

interface ResolveEffectiveAgentModeParams {
  enableAgentMode: boolean;
  supportToolUse: boolean;
}

export const resolveEffectiveAgentMode = ({
  enableAgentMode,
  supportToolUse,
}: ResolveEffectiveAgentModeParams) => {
  const currentMode: ChatInputMode = enableAgentMode && supportToolUse ? 'agent' : 'chat';
  // Example: stored Agent mode + a model without tool calling should render chat-only runtime UI.
  const isAgentRuntimeMode = currentMode === 'agent';

  return {
    canSelectAgentMode: supportToolUse,
    currentMode,
    isAgentModeUnavailable: enableAgentMode && !supportToolUse,
    isAgentRuntimeMode,
    supportToolUse,
  };
};

export const useEffectiveAgentMode = (agentId: string) => {
  const [enableAgentMode, model, provider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentEnableModeById(agentId)(s),
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);
  const supportToolUse = useModelSupportToolUse(model, provider);

  return resolveEffectiveAgentMode({ enableAgentMode, supportToolUse });
};
