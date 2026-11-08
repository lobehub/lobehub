import { useEffect, useMemo } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
  resolveImageModelSelection,
} from '@/utils/defaultImageModel';

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

    // 2-3. Shared default rule (also applied by the server when `lh gen image` omits a model)
    const selection = resolveImageModelSelection(enabledImageModelList);

    // The default pair is already the store's initial state
    if (
      !selection ||
      (selection.provider === DEFAULT_AI_IMAGE_PROVIDER &&
        selection.model === DEFAULT_AI_IMAGE_MODEL)
    ) {
      return { model: undefined, provider: undefined };
    }

    return selection;
  }, [lastSelectedImageModel, lastSelectedImageProvider, enabledImageModelList]);

  useEffect(() => {
    if (!isInitializedImageConfig && isReadyForInit) {
      initializeImageConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedImageConfig, isLogin, initParams, initializeImageConfig]);
};
