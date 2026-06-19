import type { TaskTemplate, TaskTemplateConnectorSource } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_COUNT } from '@lobechat/const';
import { createNanoId } from '@lobechat/utils';
import { useSessionStorageState } from 'ahooks';
import { App } from 'antd';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { taskTemplateKeys } from '@/libs/swr/keys';
import { taskTemplateService } from '@/services/taskTemplate';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useResolvedInterestKeys } from './useResolvedInterestKeys';

const REFRESH_SEED_STORAGE_KEY = 'lobehub:taskTemplate:refreshSeed';
const nextRefreshSeed = createNanoId(8);

export type DailyBriefRecommendationsUIState =
  | { mode: 'hidden' }
  | { mode: 'skeleton'; skeletonCount: number }
  | {
      mode: 'cards';
      onCreated: (templateId: number) => void;
      onDismiss: (templateId: number) => void;
      onRefresh: () => void;
      templates: TaskTemplate[];
    };

interface UseDailyBriefRecommendationsUIOptions {
  count?: number;
}

interface ResolveDailyBriefRecommendationRequestParams {
  interestKeys: string[] | null;
  isLogin: boolean | undefined;
  locale: string;
  recommendationCount: number;
  refreshSeed?: string;
}

export const resolveDailyBriefRecommendationRequest = ({
  interestKeys,
  isLogin,
  locale,
  recommendationCount,
  refreshSeed,
}: ResolveDailyBriefRecommendationRequestParams) => {
  const enabled = isLogin === true;

  return {
    key: enabled
      ? taskTemplateKeys.listDailyRecommend(refreshSeed ?? '', recommendationCount, locale)
      : null,
    shouldFetch: enabled && interestKeys !== null,
  };
};

interface ResolveDailyBriefRecommendationDisplayModeParams {
  canFetchRecommendations: boolean;
  hasRecommendationKey: boolean;
  hasTemplates: boolean;
  isInit: boolean;
  isLoading: boolean;
  isValidating: boolean;
  isWaitingForInterestsFetch: boolean;
}

export const resolveDailyBriefRecommendationDisplayMode = ({
  canFetchRecommendations,
  hasRecommendationKey,
  hasTemplates,
  isInit,
  isLoading,
  isValidating,
  isWaitingForInterestsFetch,
}: ResolveDailyBriefRecommendationDisplayModeParams): DailyBriefRecommendationsUIState['mode'] => {
  if (!hasRecommendationKey) return 'hidden';
  if (hasTemplates) return 'cards';
  if (
    !isInit ||
    isLoading ||
    isValidating ||
    !canFetchRecommendations ||
    isWaitingForInterestsFetch
  ) {
    return 'skeleton';
  }

  return 'hidden';
};

export function useDailyBriefRecommendationsUI(
  options: UseDailyBriefRecommendationsUIOptions = {},
): DailyBriefRecommendationsUIState {
  const { count } = options;
  const recommendationCount = count ?? TASK_TEMPLATE_RECOMMEND_COUNT;
  const { i18n, t } = useTranslation('taskTemplate');
  const locale = i18n.resolvedLanguage || i18n.language;
  const { message } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin);

  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  const interestKeys = useResolvedInterestKeys();
  const [refreshSeed, setRefreshSeed] = useSessionStorageState<string>(REFRESH_SEED_STORAGE_KEY, {
    defaultValue: '',
  });

  const recommendationRequest = useMemo(
    () =>
      resolveDailyBriefRecommendationRequest({
        interestKeys,
        isLogin,
        locale,
        recommendationCount,
        refreshSeed,
      }),
    [interestKeys, isLogin, locale, recommendationCount, refreshSeed],
  );
  const canFetchRecommendations = recommendationRequest.shouldFetch && interestKeys !== null;
  const recommendationFetcher = canFetchRecommendations
    ? async () =>
        taskTemplateService.listDailyRecommend(interestKeys, {
          count: recommendationCount,
          locale,
          refreshSeed: refreshSeed || undefined,
        })
    : null;

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    recommendationRequest.key,
    recommendationFetcher,
    {
      keepPreviousData: true,
      revalidateIfStale: canFetchRecommendations,
      revalidateOnFocus: false,
      revalidateOnMount: canFetchRecommendations,
      revalidateOnReconnect: false,
    },
  );
  const waitedForInterestsRef = useRef(false);

  useEffect(() => {
    if (!recommendationRequest.key) {
      waitedForInterestsRef.current = false;
      return;
    }

    if (interestKeys === null) {
      waitedForInterestsRef.current = true;
      return;
    }

    if (!waitedForInterestsRef.current) return;
    waitedForInterestsRef.current = false;
    void mutate();
  }, [interestKeys, mutate, recommendationRequest.key]);

  useEffect(() => {
    if (error) console.error('[taskTemplate:listDailyRecommend]', error);
  }, [error]);

  const handleRefresh = useCallback(() => {
    setRefreshSeed(nextRefreshSeed());
  }, [setRefreshSeed]);

  const removeTemplateFromList = useCallback(
    (templateId: number) => {
      mutate(
        (current) =>
          current
            ? { ...current, data: current.data.filter((tmpl) => tmpl.id !== templateId) }
            : current,
        { revalidate: false },
      );
    },
    [mutate],
  );

  const handleCreated = useCallback(
    (templateId: number) => {
      removeTemplateFromList(templateId);
    },
    [removeTemplateFromList],
  );

  const handleDismiss = useCallback(
    async (templateId: number) => {
      removeTemplateFromList(templateId);
      try {
        await taskTemplateService.dismiss(templateId);
      } catch (error) {
        console.error('[taskTemplate:dismiss]', error);
        message.error(t('action.dismiss.error'));
        mutate();
      }
    },
    [message, mutate, removeTemplateFromList, t],
  );

  const templates = useMemo(() => data?.data ?? [], [data]);
  const requiredSources = useMemo(() => {
    const sources = new Set<TaskTemplateConnectorSource>();
    for (const tmpl of templates) {
      for (const connector of tmpl.connectors) sources.add(connector.source);
    }
    return sources;
  }, [templates]);
  const useFetchUserComposioConnections = useToolStore((s) => s.useFetchUserComposioConnections);
  const useFetchLobehubConnectorConnections = useToolStore(
    (s) => s.useFetchLobehubSkillConnections,
  );
  useFetchUserComposioConnections(requiredSources.has('composio'));
  useFetchLobehubConnectorConnections(requiredSources.has('lobehub'));

  const displayMode = resolveDailyBriefRecommendationDisplayMode({
    canFetchRecommendations,
    hasRecommendationKey: Boolean(recommendationRequest.key),
    hasTemplates: templates.length > 0,
    isInit,
    isLoading,
    isValidating,
    isWaitingForInterestsFetch: interestKeys !== null && waitedForInterestsRef.current,
  });
  if (error) return { mode: 'hidden' };
  if (displayMode === 'hidden') return { mode: 'hidden' };
  if (displayMode === 'skeleton') return { mode: 'skeleton', skeletonCount: recommendationCount };

  return {
    mode: 'cards',
    onCreated: handleCreated,
    onDismiss: handleDismiss,
    onRefresh: handleRefresh,
    templates,
  };
}
