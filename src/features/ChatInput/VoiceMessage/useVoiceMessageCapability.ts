import { ModelProvider } from 'model-bank/modelProvider';

import { useEffectiveAgentModePreference } from '@/features/ChatInput/hooks/effectiveAgentModePreference';
import { getMultimodalUnderstandingMediaAbility } from '@/hooks/useMediaUploadAbility';
import { getAiInfraStoreState, useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import type { AiInfraStore } from '@/store/aiInfra/store';
import {
  getServerConfigStoreState,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

interface VoiceMessageActionStateInput {
  canRecordVoiceMessage: boolean;
  canSendRecording: boolean;
  hasRecoverableError: boolean;
}

export const getVoiceMessageActionState = ({
  canRecordVoiceMessage,
  canSendRecording,
  hasRecoverableError,
}: VoiceMessageActionStateInput) => {
  const canSend = canRecordVoiceMessage && canSendRecording;
  const showRetry = canRecordVoiceMessage && hasRecoverableError;

  return {
    canSend,
    sendDisabled: !showRetry && !canSend,
    showRetry,
  };
};

interface RawAudioCapabilityInput {
  isCuratedModel: boolean;
  modelSupportsAudio: boolean;
  provider: string;
  runtimeProvider: string;
}

const DIRECT_AUDIO_RUNTIMES = new Set<string>([
  ModelProvider.Google,
  ModelProvider.OpenAI,
  ModelProvider.VertexAI,
]);

const CURATED_AUDIO_ROUTERS = new Set<string>([ModelProvider.AiHubMix]);

interface MultimodalUnderstandingConfig {
  enabled: boolean;
  model?: string;
  provider?: string;
}

interface VoiceMessageCapabilityInput {
  enableAgentMode: boolean;
  isAgentModePreferenceLoading?: boolean;
  model?: string;
  multimodalUnderstanding?: MultimodalUnderstandingConfig;
  provider?: string;
  state?: AiInfraStore;
}

const getMultimodalUnderstandingConfig = (): MultimodalUnderstandingConfig => {
  const state = getServerConfigStoreState();
  if (!state) return { enabled: false };

  const config = serverConfigSelectors.multimodalUnderstanding(state);

  return {
    enabled: serverConfigSelectors.enableMultimodalUnderstanding(state),
    model: config?.model,
    provider: config?.provider,
  };
};

export const supportsRawAudioMessage = ({
  isCuratedModel,
  modelSupportsAudio,
  provider,
  runtimeProvider,
}: RawAudioCapabilityInput) => {
  if (!modelSupportsAudio) return false;

  return (
    DIRECT_AUDIO_RUNTIMES.has(runtimeProvider) ||
    // LobeHub's enabled model list is curated by the server. The OSS model bank
    // intentionally has no LobeHub cards, so requiring a duplicate builtin card
    // would disable local Electron / Debug Proxy sessions connected to Cloud.
    provider === ModelProvider.LobeHub ||
    (isCuratedModel && CURATED_AUDIO_ROUTERS.has(provider))
  );
};

export const getVoiceMessageCapability = ({
  enableAgentMode,
  isAgentModePreferenceLoading = false,
  model,
  multimodalUnderstanding = getMultimodalUnderstandingConfig(),
  provider,
  state = getAiInfraStoreState(),
}: VoiceMessageCapabilityInput) => {
  if (!model || !provider) return false;

  const modelSupportsAudio = aiModelSelectors.isModelSupportAudio(model, provider)(state);
  const isCuratedModel = state.builtinAiModelList.some(
    (item) => item.id === model && item.providerId === provider,
  );
  const isBuiltinProvider = Object.values(ModelProvider).includes(provider as ModelProvider);
  const runtimeProvider = isBuiltinProvider
    ? provider
    : aiProviderSelectors.providerConfigById(provider)(state)?.settings.sdkType ||
      ModelProvider.OpenAI;

  const supportsDirectAudio = supportsRawAudioMessage({
    isCuratedModel,
    modelSupportsAudio,
    provider,
    runtimeProvider,
  });
  if (supportsDirectAudio) return true;

  // The fallback runs through lobe-agent.analyzeMedia, which Chat mode does not expose.
  if (!enableAgentMode || isAgentModePreferenceLoading) return false;

  const fallbackModelId = multimodalUnderstanding.model;
  const fallbackProvider = multimodalUnderstanding.provider;
  const fallbackConfigured = !!(fallbackModelId && fallbackProvider);
  const fallbackModel =
    fallbackModelId && fallbackProvider
      ? aiModelSelectors.getEnabledModelById(fallbackModelId, fallbackProvider)(state)
      : undefined;

  return getMultimodalUnderstandingMediaAbility({
    enableMultimodalUnderstanding: multimodalUnderstanding.enabled,
    fallbackConfigured,
    fallbackModelAbilities: fallbackModel?.abilities,
    supportToolUse: aiModelSelectors.isModelSupportToolUse(model, provider)(state),
  }).audio;
};

export const useVoiceMessageCapability = (model?: string, provider?: string, agentId?: string) => {
  const { enableAgentMode, isPreferenceLoading } = useEffectiveAgentModePreference(agentId || '');
  const enabled = useServerConfigStore(serverConfigSelectors.enableMultimodalUnderstanding);
  const config = useServerConfigStore(serverConfigSelectors.multimodalUnderstanding);

  return useAiInfraStore((state) =>
    getVoiceMessageCapability({
      enableAgentMode,
      isAgentModePreferenceLoading: isPreferenceLoading,
      model,
      multimodalUnderstanding: {
        enabled,
        model: config?.model,
        provider: config?.provider,
      },
      provider,
      state,
    }),
  );
};
