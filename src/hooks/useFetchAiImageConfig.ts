import { useEffect, useMemo } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
} from '@/store/image/slices/generationConfig/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const checkModelEnabled = (
  enabledImageModelList: ReturnType<typeof aiProviderSelectors.enabledImageModelList>,
  provider: string,
  model: string,
) => {
  return enabledImageModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

export const useFetchAiImageConfig = () => {
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const isInitAiProviderRuntimeState = useAiInfraStore(
    aiProviderSelectors.isInitAiProviderRuntimeState,
  );

  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isActualLogout = isAuthLoaded && isLogin === false;

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isUserStateReady = isUserStateInit || isActualLogout;

  const isReadyForInit = isStatusInit && isInitAiProviderRuntimeState && isUserStateReady;

  const { lastSelectedImageModel, lastSelectedImageProvider } = useGlobalStore((s) => ({
    lastSelectedImageModel: s.status.lastSelectedImageModel,
    lastSelectedImageProvider: s.status.lastSelectedImageProvider,
  }));
  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);

  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  // Determine which model/provider to use for initialization
  const initParams = useMemo(() => {
    // 1. Try lastSelected if enabled
    if (
      lastSelectedImageModel &&
      lastSelectedImageProvider &&
      checkModelEnabled(enabledImageModelList, lastSelectedImageProvider, lastSelectedImageModel)
    ) {
      return { model: lastSelectedImageModel, provider: lastSelectedImageProvider };
    }

    // 2. Try default model from any enabled provider (prefer default provider first)
    if (
      checkModelEnabled(enabledImageModelList, DEFAULT_AI_IMAGE_PROVIDER, DEFAULT_AI_IMAGE_MODEL)
    ) {
      return { model: undefined, provider: undefined }; // Use initialState defaults
    }
    const providerWithDefaultModel = enabledImageModelList.find((p) =>
      p.children.some((m) => m.id === DEFAULT_AI_IMAGE_MODEL),
    );
    if (providerWithDefaultModel) {
      return { model: DEFAULT_AI_IMAGE_MODEL, provider: providerWithDefaultModel.id };
    }

    // 3. Fallback to first enabled model
    const firstProvider = enabledImageModelList[0];
    const firstModel = firstProvider?.children[0];
    if (firstProvider && firstModel) {
      return { model: firstModel.id, provider: firstProvider.id };
    }

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [lastSelectedImageModel, lastSelectedImageProvider, enabledImageModelList]);

  useEffect(() => {
    if (!isInitializedImageConfig && isReadyForInit) {
      initializeImageConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedImageConfig, isLogin, initParams, initializeImageConfig]);
};
