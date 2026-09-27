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
import { getAgentStoreState, useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getUserStoreState, useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * Heterogeneous agents take text only: their voice turns are transcribed before sending, so the
 * recorder depends on a configured speech-to-text model rather than on the conversation model
 * accepting audio.
 */
export const isVoiceMessageTranscribed = (context: ConversationContext) =>
  agentByIdSelectors.isAgentHeterogeneousById(context.agentId)(getAgentStoreState());

export const canSendVoiceMessage = (context: ConversationContext) => {
  if (isVoiceMessageTranscribed(context))
    return systemAgentSelectors.isAsrConfigured(getUserStoreState());

  const { model, provider } = getEffectiveConversationModelConfig(context);
  const enableAgentMode = getEffectiveAgentModePreference(context.agentId);

  return getVoiceMessageCapability({ enableAgentMode, model, provider });
};

export const useCanSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = useEffectiveConversationModelConfig(context);
  const isTranscribed = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(context.agentId));
  const isAsrConfigured = useUserStore(systemAgentSelectors.isAsrConfigured);
  const canSendRawAudio = useVoiceMessageCapability(model, provider, context.agentId);

  return isTranscribed ? isAsrConfigured : canSendRawAudio;
};
