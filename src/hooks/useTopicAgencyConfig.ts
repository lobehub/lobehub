import { resolveTopicAgencyConfig } from '@/helpers/topicExecutionConfig';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

/** Chat-only overlay; Agent profile settings continue to edit defaults. */
export const useTopicAgencyConfig = (agentId?: string, topicId?: string | null) => {
  const defaults = useEffectiveAgencyConfig(agentId);
  const execution = useChatStore((s) =>
    topicId !== undefined
      ? topicId
        ? topicSelectors.getTopicById(topicId)(s)?.metadata?.executionConfig
        : undefined
      : s.activeAgentId === agentId && s.activeTopicId
        ? topicSelectors.getTopicById(s.activeTopicId)(s)?.metadata?.executionConfig
        : undefined,
  );
  return {
    ...defaults,
    ...resolveTopicAgencyConfig(defaults.agencyConfig, execution, defaults.workspaceScoped),
  };
};
