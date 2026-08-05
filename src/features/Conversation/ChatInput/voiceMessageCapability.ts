import type { ConversationContext } from '@lobechat/types';

import { getVoiceMessageCapability } from '@/features/ChatInput/VoiceMessage/useVoiceMessageCapability';
import { getEffectiveConversationModelConfig } from '@/features/Conversation/store/utils/effectiveModel';

export const canSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = getEffectiveConversationModelConfig(context);

  return getVoiceMessageCapability(model, provider);
};
