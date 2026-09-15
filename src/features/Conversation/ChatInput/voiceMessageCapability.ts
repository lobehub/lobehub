import type { ConversationContext } from '@lobechat/types';

import { getEffectiveAgentModePreference } from '@/features/ChatInput/hooks/effectiveAgentModePreference';
import {
  getVoiceMessageCapability,
  useVoiceMessageCapability,
} from '@/features/ChatInput/VoiceMessage/useVoiceMessageCapability';
import {
  getEffectiveConversationModelConfig,
  useEffectiveConversationModelConfig,
} from '@/features/Conversation/store/utils/effectiveModel';

export const canSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = getEffectiveConversationModelConfig(context);
  const enableAgentMode = getEffectiveAgentModePreference(context.agentId);

  return getVoiceMessageCapability({ enableAgentMode, model, provider });
};

export const useCanSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = useEffectiveConversationModelConfig(context);

  return useVoiceMessageCapability(model, provider, context.agentId);
};
