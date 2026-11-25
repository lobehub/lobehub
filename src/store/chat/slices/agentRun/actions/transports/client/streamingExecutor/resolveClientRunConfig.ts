import { resolveSubAgentChatConfig } from '@lobechat/const';
import type { AgentConfigResolverContext } from '@lobechat/mecha';
import type { ConversationMode, LobeAgentChatConfig } from '@lobechat/types';

import { resolveAgentConfig } from '@/services/chat/mecha';

export const resolveClientRunConfig = ({
  context,
  conversationMode,
  topicModel,
  modelOverride,
  chatConfigOverride,
}: {
  chatConfigOverride?: Partial<LobeAgentChatConfig> | null;
  context: AgentConfigResolverContext;
  conversationMode?: ConversationMode;
  modelOverride?: { model: string; provider: string };
  topicModel?: { model: string; provider: string };
}) => {
  const resolved = resolveAgentConfig(context, conversationMode);
  const modelResolution = modelOverride ?? topicModel;
  return (modelResolution || chatConfigOverride) && resolved.agentConfig
    ? {
        ...resolved,
        ...(modelResolution
          ? { agentConfig: { ...resolved.agentConfig, ...modelResolution } }
          : {}),
        ...(chatConfigOverride
          ? {
              chatConfig:
                resolveSubAgentChatConfig(resolved.chatConfig, chatConfigOverride) ??
                resolved.chatConfig,
              subAgentChatConfigOverride: chatConfigOverride,
            }
          : {}),
      }
    : resolved;
};
