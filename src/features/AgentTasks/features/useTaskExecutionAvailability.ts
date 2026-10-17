import { useAgentDefaultModelAgentMode } from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Whether a task assigned to this agent has an execution environment to pick.
 *
 * Heterogeneous agents always execute somewhere; a plain agent only has one in
 * agent mode (chat mode means "no tools, no device") — the same gate the chat
 * composer uses for this cluster. There is no topic context here: the assignee
 * is judged by its own default model, never the chat page's active topic pin.
 * `false` while the mode preference is still loading.
 */
export const useTaskExecutionAvailability = (assigneeAgentId: string): boolean => {
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(assigneeAgentId));
  const { isAgentRuntimeMode, isPreferenceLoading } =
    useAgentDefaultModelAgentMode(assigneeAgentId);

  return !isPreferenceLoading && (isHetero || isAgentRuntimeMode);
};
