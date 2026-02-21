import { useEffect, useMemo } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useVideoStore } from '@/store/video';
import {
  DEFAULT_AI_VIDEO_MODEL,
  DEFAULT_AI_VIDEO_PROVIDER,
} from '@/store/video/slices/generationConfig/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const checkModelEnabled = (
  enabledVideoModelList: ReturnType<typeof aiProviderSelectors.enabledVideoModelList>,
  provider: string,
  model: string,
) => {
  return enabledVideoModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

export const useFetchAiVideoConfig = () => {
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

  const { lastSelectedVideoModel, lastSelectedVideoProvider } = useGlobalStore((s) => ({
    lastSelectedVideoModel: s.status.lastSelectedVideoModel,
    lastSelectedVideoProvider: s.status.lastSelectedVideoProvider,
  }));
  const isInitializedVideoConfig = useVideoStore((s) => s.isInit);
  const initializeVideoConfig = useVideoStore((s) => s.initializeVideoConfig);

  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);

  // Determine which model/provider to use for initialization
  const initParams = useMemo(() => {
    // 1. Try lastSelected if enabled
    if (
      lastSelectedVideoModel &&
      lastSelectedVideoProvider &&
      checkModelEnabled(enabledVideoModelList, lastSelectedVideoProvider, lastSelectedVideoModel)
    ) {
      return { model: lastSelectedVideoModel, provider: lastSelectedVideoProvider };
    }

    // 2. Try default model from any enabled provider (prefer default provider first)
    if (
      checkModelEnabled(enabledVideoModelList, DEFAULT_AI_VIDEO_PROVIDER, DEFAULT_AI_VIDEO_MODEL)
    ) {
      return { model: undefined, provider: undefined }; // Use initialState defaults
    }
    const providerWithDefaultModel = enabledVideoModelList.find((p) =>
      p.children.some((m) => m.id === DEFAULT_AI_VIDEO_MODEL),
    );
    if (providerWithDefaultModel) {
      return { model: DEFAULT_AI_VIDEO_MODEL, provider: providerWithDefaultModel.id };
    }

    // 3. Fallback to first enabled model
    const firstProvider = enabledVideoModelList[0];
    const firstModel = firstProvider?.children[0];
    if (firstProvider && firstModel) {
      return { model: firstModel.id, provider: firstProvider.id };
    }

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [lastSelectedVideoModel, lastSelectedVideoProvider, enabledVideoModelList]);

  useEffect(() => {
    if (!isInitializedVideoConfig && isReadyForInit) {
      initializeVideoConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedVideoConfig, isLogin, initParams, initializeVideoConfig]);
};
