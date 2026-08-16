import { useEffect, useMemo } from 'react';

import { useEnabledImageModels } from '@/hooks/useEnabledImageModels';
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
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const checkModelEnabled = (
  enabledImageModelList: EnabledProviderWithModels[],
  provider: string,
  model: string,
) => {
  return enabledImageModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

/** Prefer Nano Banana family when the hard-coded default is missing from the list. */
export const PREFERRED_AI_IMAGE_MODEL_IDS = [
  DEFAULT_AI_IMAGE_MODEL,
  'google/gemini-2.5-flash-image:image',
  'google/gemini-3-pro-image-preview:image',
] as const;

/**
 * Pick the best available Image Create model from the enabled list.
 * Prefers OpenRouter Nano Banana defaults, then any "Nano Banana*" display name,
 * then the first enabled model.
 */
export const resolvePreferredImageModel = (
  enabledImageModelList: EnabledProviderWithModels[],
): { model: string; provider: string } | undefined => {
  if (enabledImageModelList.length === 0) return undefined;

  for (const modelId of PREFERRED_AI_IMAGE_MODEL_IDS) {
    const providerGroup = enabledImageModelList.find((p) =>
      p.children.some((m) => m.id === modelId),
    );
    if (providerGroup) return { model: modelId, provider: providerGroup.id };
  }

  for (const providerGroup of enabledImageModelList) {
    const nanoBanana = providerGroup.children.find((m) =>
      /nano\s*banana/i.test(m.displayName || ''),
    );
    if (nanoBanana) return { model: nanoBanana.id, provider: providerGroup.id };
  }

  const firstProvider = enabledImageModelList[0];
  const firstModel = firstProvider?.children[0];
  if (firstProvider && firstModel) {
    return { model: firstModel.id, provider: firstProvider.id };
  }

  return undefined;
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

  const { list: enabledImageModelList, isManagedStatusLoading } = useEnabledImageModels();

  const isReadyForInit =
    isStatusInit && isInitAiProviderRuntimeState && isUserStateReady && !isManagedStatusLoading;

  const { lastSelectedImageModel, lastSelectedImageProvider } = useGlobalStore((s) => ({
    lastSelectedImageModel: s.status.lastSelectedImageModel,
    lastSelectedImageProvider: s.status.lastSelectedImageProvider,
  }));
  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const currentModel = useImageStore((s) => s.model);
  const currentProvider = useImageStore((s) => s.provider);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);

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

    // 2. Prefer default OpenRouter Nano Banana when present
    if (
      checkModelEnabled(enabledImageModelList, DEFAULT_AI_IMAGE_PROVIDER, DEFAULT_AI_IMAGE_MODEL)
    ) {
      return { model: undefined, provider: undefined }; // Use initialState defaults
    }

    // 3. Prefer Nano Banana family / first available model
    const preferred = resolvePreferredImageModel(enabledImageModelList);
    if (preferred) return preferred;

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [lastSelectedImageModel, lastSelectedImageProvider, enabledImageModelList]);

  useEffect(() => {
    if (!isInitializedImageConfig && isReadyForInit) {
      initializeImageConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedImageConfig, isLogin, initParams, initializeImageConfig]);

  // Heal sticky defaults (e.g. OpenRouter before `:image` builtins existed) once
  // the enabled image list is ready and the current selection is unavailable.
  useEffect(() => {
    if (!isInitializedImageConfig || !isReadyForInit) return;
    if (enabledImageModelList.length === 0) return;
    if (checkModelEnabled(enabledImageModelList, currentProvider, currentModel)) return;

    const preferred = resolvePreferredImageModel(enabledImageModelList);
    if (!preferred) return;
    if (preferred.model === currentModel && preferred.provider === currentProvider) return;

    setModelAndProviderOnSelect(preferred.model, preferred.provider);
  }, [
    isInitializedImageConfig,
    isReadyForInit,
    enabledImageModelList,
    currentModel,
    currentProvider,
    setModelAndProviderOnSelect,
  ]);
};
