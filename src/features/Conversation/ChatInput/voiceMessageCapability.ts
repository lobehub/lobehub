import type { ConversationContext } from '@lobechat/types';

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

  return getVoiceMessageCapability(model, provider);
};

export const useCanSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = useEffectiveConversationModelConfig(context);

  return useVoiceMessageCapability(model, provider);
};
