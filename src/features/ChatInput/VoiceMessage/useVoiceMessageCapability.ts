import { ModelProvider } from 'model-bank/modelProvider';

import { getAiInfraStoreState, useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import type { AiInfraStore } from '@/store/aiInfra/store';

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

const CURATED_AUDIO_ROUTERS = new Set<string>([ModelProvider.AiHubMix, ModelProvider.LobeHub]);

export const supportsRawAudioMessage = ({
  isCuratedModel,
  modelSupportsAudio,
  provider,
  runtimeProvider,
}: RawAudioCapabilityInput) => {
  if (!modelSupportsAudio) return false;

  return (
    DIRECT_AUDIO_RUNTIMES.has(runtimeProvider) ||
    (isCuratedModel && CURATED_AUDIO_ROUTERS.has(provider))
  );
};

export const getVoiceMessageCapability = (
  model?: string,
  provider?: string,
  state: AiInfraStore = getAiInfraStoreState(),
) => {
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

  return supportsRawAudioMessage({
    isCuratedModel,
    modelSupportsAudio,
    provider,
    runtimeProvider,
  });
};

export const useVoiceMessageCapability = (model?: string, provider?: string) =>
  useAiInfraStore((state) => getVoiceMessageCapability(model, provider, state));
