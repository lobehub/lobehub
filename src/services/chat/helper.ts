import { ModelProvider } from 'model-bank';

import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';
import type {
  ChatStreamPayload,
  OpenAIChatMessage,
  UserMessageContentPart,
} from '@/types/openai/chat';

const getModelAbilities = (model: string, provider: string) => {
  const state = getAiInfraStoreState();
  const exactModel = state.enabledAiModels?.find(
    (item) => item.id === model && item.providerId === provider,
  );

  if (exactModel || provider !== ModelProvider.LobeHub) return exactModel?.abilities;

  return state.enabledAiModels?.find((item) => item.id === model)?.abilities;
};

export const isCanUseVision = (model: string, provider: string): boolean => {
  return getModelAbilities(model, provider)?.vision || false;
};

export const isCanUseVideo = (model: string, provider: string): boolean => {
  return getModelAbilities(model, provider)?.video || false;
};

/**
 * TODO: we need to update this function to auto find deploymentName with provider setting config
 */
export const findDeploymentName = (model: string, provider: string) => {
  let deploymentId = model;

  // find the model by id
  const modelItem = getAiInfraStoreState().enabledAiModels?.find(
    (i) => i.id === model && i.providerId === provider,
  );

  if (modelItem && modelItem.config?.deploymentName) {
    deploymentId = modelItem.config?.deploymentName;
  }

  return deploymentId;
};

export const isEnableFetchOnClient = (provider: string) => {
  return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
};

const getImageUrl = (part: UserMessageContentPart) => {
  if (part.type !== 'image_url') return undefined;

  return part.image_url.url;
};

const getVideoUrl = (part: UserMessageContentPart) => {
  if (part.type !== 'video_url') return undefined;

  return part.video_url?.url;
};

const isRemoteUrl = (url: string | undefined) => !!url && !url.startsWith('data:');

const hasRemoteVisionMedia = (
  messages: OpenAIChatMessage[] | undefined,
  options: { image?: boolean; video?: boolean },
) =>
  messages?.some((message) => {
    if (!Array.isArray(message.content)) return false;

    return message.content.some((part) => {
      if (options.image && isRemoteUrl(getImageUrl(part))) return true;
      if (options.video && isRemoteUrl(getVideoUrl(part))) return true;

      return false;
    });
  }) || false;

export const shouldUseServerSideVisionBase64 = (payload: Partial<ChatStreamPayload>) => {
  const serverConfig = getServerConfigStoreState();
  if (!serverConfig) return false;

  const useImageBase64 = serverConfigSelectors.useVisionImageBase64(serverConfig);
  const useVideoBase64 = serverConfigSelectors.useVisionVideoBase64(serverConfig);

  if (!useImageBase64 && !useVideoBase64) return false;

  return hasRemoteVisionMedia(payload.messages, {
    image: useImageBase64,
    video: useVideoBase64,
  });
};

export const resolveRuntimeProvider = (provider: string) => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as any);
  if (isBuiltin) return provider;

  const providerConfig = aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState());

  return providerConfig?.settings.sdkType || 'openai';
};
