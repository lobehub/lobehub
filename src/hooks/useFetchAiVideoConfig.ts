import { useEffect, useMemo } from 'react';

import { useEnabledVideoModels } from '@/hooks/useEnabledVideoModels';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { useVideoStore } from '@/store/video';
import {
  DEFAULT_AI_VIDEO_MODEL,
  DEFAULT_AI_VIDEO_PROVIDER,
} from '@/store/video/slices/generationConfig/initialState';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const checkModelEnabled = (
  enabledVideoModelList: EnabledProviderWithModels[],
  provider: string,
  model: string,
) => {
  return enabledVideoModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

/** Prefer Veo / Sora families when the hard-coded LobeHub default is missing. */
export const PREFERRED_AI_VIDEO_MODEL_PREFIXES = ['google/veo', 'openai/sora'] as const;

/**
 * Pick the best available Video Create model from the enabled list.
 * Prefers Veo, then Sora, then the first enabled model.
 */
export const resolvePreferredVideoModel = (
  enabledVideoModelList: EnabledProviderWithModels[],
): { model: string; provider: string } | undefined => {
  if (enabledVideoModelList.length === 0) return undefined;

  for (const prefix of PREFERRED_AI_VIDEO_MODEL_PREFIXES) {
    for (const providerGroup of enabledVideoModelList) {
      const match = providerGroup.children.find((m) => m.id.startsWith(prefix));
      if (match) return { model: match.id, provider: providerGroup.id };
    }
  }

  const firstProvider = enabledVideoModelList[0];
  const firstModel = firstProvider?.children[0];
  if (firstProvider && firstModel) {
    return { model: firstModel.id, provider: firstProvider.id };
  }

  return undefined;
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

  const { list: enabledVideoModelList, isManagedStatusLoading } = useEnabledVideoModels();

  const isReadyForInit =
    isStatusInit && isInitAiProviderRuntimeState && isUserStateReady && !isManagedStatusLoading;

  const { lastSelectedVideoModel, lastSelectedVideoProvider } = useGlobalStore((s) => ({
    lastSelectedVideoModel: s.status.lastSelectedVideoModel,
    lastSelectedVideoProvider: s.status.lastSelectedVideoProvider,
  }));
  const isInitializedVideoConfig = useVideoStore((s) => s.isInit);
  const currentModel = useVideoStore((s) => s.model);
  const currentProvider = useVideoStore((s) => s.provider);
  const initializeVideoConfig = useVideoStore((s) => s.initializeVideoConfig);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);

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

    // 3. Prefer Veo / Sora / first available model
    const preferred = resolvePreferredVideoModel(enabledVideoModelList);
    if (preferred) return preferred;

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [lastSelectedVideoModel, lastSelectedVideoProvider, enabledVideoModelList]);

  useEffect(() => {
    if (!isInitializedVideoConfig && isReadyForInit) {
      initializeVideoConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedVideoConfig, isLogin, initParams, initializeVideoConfig]);

  // Heal sticky LobeHub defaults once the enabled video list is ready and the
  // current selection is unavailable (Aico managed mode filters lobehub).
  useEffect(() => {
    if (!isInitializedVideoConfig || !isReadyForInit) return;
    if (enabledVideoModelList.length === 0) return;
    if (checkModelEnabled(enabledVideoModelList, currentProvider, currentModel)) return;

    const preferred = resolvePreferredVideoModel(enabledVideoModelList);
    if (!preferred) return;
    if (preferred.model === currentModel && preferred.provider === currentProvider) return;

    setModelAndProviderOnSelect(preferred.model, preferred.provider);
  }, [
    isInitializedVideoConfig,
    isReadyForInit,
    enabledVideoModelList,
    currentModel,
    currentProvider,
    setModelAndProviderOnSelect,
  ]);
};
