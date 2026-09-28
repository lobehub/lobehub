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
import { getAiInfraStoreState, useAiInfraStore } from '@/store/aiInfra';
import type { AiInfraStore } from '@/store/aiInfra/store';
import { getUserStoreState, useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * A chosen speech-to-text model only counts once its provider is enabled: the default points at
 * a provider a deployment may not have configured, and a button that can only fail is worse than
 * none.
 */
const isAsrProviderEnabled = (provider: string) => (s: AiInfraStore) =>
  !!provider && !!s.enabledAiProviders?.some((item) => item.id === provider);

/**
 * Heterogeneous agents take text only: their voice turns are transcribed before sending, so the
 * recorder depends on a configured speech-to-text model rather than on the conversation model
 * accepting audio.
 */
export const isVoiceMessageTranscribed = (context: ConversationContext) =>
  agentByIdSelectors.isAgentHeterogeneousById(context.agentId)(getAgentStoreState());

export const canSendVoiceMessage = (context: ConversationContext) => {
  if (isVoiceMessageTranscribed(context)) {
    const userState = getUserStoreState();
    const { provider } = systemAgentSelectors.asr(userState);

    return (
      systemAgentSelectors.isAsrConfigured(userState) &&
      isAsrProviderEnabled(provider)(getAiInfraStoreState())
    );
  }

  const { model, provider } = getEffectiveConversationModelConfig(context);
  const enableAgentMode = getEffectiveAgentModePreference(context.agentId);

  return getVoiceMessageCapability({ enableAgentMode, model, provider });
};

export const useCanSendVoiceMessage = (context: ConversationContext) => {
  const { model, provider } = useEffectiveConversationModelConfig(context);
  const isTranscribed = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(context.agentId));
  const isAsrConfigured = useUserStore(systemAgentSelectors.isAsrConfigured);
  const asrProvider = useUserStore((s) => systemAgentSelectors.asr(s).provider);
  const isAsrProviderReady = useAiInfraStore(isAsrProviderEnabled(asrProvider));
  const canSendRawAudio = useVoiceMessageCapability(model, provider, context.agentId);

  return isTranscribed ? isAsrConfigured && isAsrProviderReady : canSendRawAudio;
};
