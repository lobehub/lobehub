import { useEffect, useMemo } from 'react';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useMusicStore } from '@/store/music';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

type EnabledMusicModelList = ReturnType<typeof aiProviderSelectors.enabledMusicModelList>;

const isModelEnabled = (list: EnabledMusicModelList, provider?: string, model?: string) =>
  !!provider &&
  !!model &&
  list.some((p) => p.id === provider && p.children.some((m) => m.id === model));

/**
 * Pick the music model the page opens with: the last selection while it is enabled, then the
 * first enabled music model. Always returns a concrete model when one is enabled, because the
 * store's placeholder schema is prompt-only and the page shows params from the resolved schema.
 */
export const resolveInitialMusicModel = (
  list: EnabledMusicModelList,
  lastModel?: string,
  lastProvider?: string,
): { model?: string; provider?: string } => {
  if (isModelEnabled(list, lastProvider, lastModel)) {
    return { model: lastModel, provider: lastProvider };
  }

  const firstProvider = list.find((p) => p.children.length > 0);
  if (firstProvider) return { model: firstProvider.children[0].id, provider: firstProvider.id };

  return {};
};

export const useFetchAiMusicConfig = () => {
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

  const { lastSelectedMusicModel, lastSelectedMusicProvider } = useGlobalStore((s) => ({
    lastSelectedMusicModel: s.status.lastSelectedMusicModel,
    lastSelectedMusicProvider: s.status.lastSelectedMusicProvider,
  }));
  const isInitializedMusicConfig = useMusicStore((s) => s.isInit);
  const initializeMusicConfig = useMusicStore((s) => s.initializeMusicConfig);
  const enabledMusicModelList = useAiInfraStore(aiProviderSelectors.enabledMusicModelList);

  const initParams = useMemo(
    () =>
      resolveInitialMusicModel(
        enabledMusicModelList,
        lastSelectedMusicModel,
        lastSelectedMusicProvider,
      ),
    [enabledMusicModelList, lastSelectedMusicModel, lastSelectedMusicProvider],
  );

  useEffect(() => {
    if (!isInitializedMusicConfig && isReadyForInit) {
      initializeMusicConfig(initParams.model, initParams.provider);
    }
  }, [isReadyForInit, isInitializedMusicConfig, initParams, initializeMusicConfig]);
};
