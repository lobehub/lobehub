import type { TaskTemplate, TaskTemplateSkillSource } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_COUNT } from '@lobechat/const';
import { createNanoId } from '@lobechat/utils';
import { useSessionStorageState } from 'ahooks';
import { App } from 'antd';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

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
      onCreated: (templateId: string) => void;
      onDismiss: (templateId: string) => void;
      onRefresh: () => void;
      templates: TaskTemplate[];
    };

interface UseDailyBriefRecommendationsUIOptions {
  count?: number;
}

export function useDailyBriefRecommendationsUI(
  options: UseDailyBriefRecommendationsUIOptions = {},
): DailyBriefRecommendationsUIState {
  const { count } = options;
  const recommendationCount = count ?? TASK_TEMPLATE_RECOMMEND_COUNT;
  const { t } = useTranslation('taskTemplate');
  const { message } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin);

  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  const interestKeys = useResolvedInterestKeys();
  const swrKey = interestKeys ? [...interestKeys].sort().join(',') : '';
  const swrEnabled = isLogin && interestKeys !== null;
  const [refreshSeed, setRefreshSeed] = useSessionStorageState<string>(REFRESH_SEED_STORAGE_KEY, {
    defaultValue: '',
  });

  const { data, isLoading, mutate } = useSWR(
    swrEnabled
      ? ['taskTemplate.listDailyRecommend', swrKey, refreshSeed, recommendationCount]
      : null,
    async () =>
      taskTemplateService.listDailyRecommend(interestKeys ?? [], {
        count: recommendationCount,
        refreshSeed: refreshSeed || undefined,
      }),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const handleRefresh = useCallback(() => {
    setRefreshSeed(nextRefreshSeed());
  }, [setRefreshSeed]);

  const removeTemplateFromList = useCallback(
    (templateId: string) => {
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
    (templateId: string) => {
      removeTemplateFromList(templateId);
    },
    [removeTemplateFromList],
  );

  const handleDismiss = useCallback(
    async (templateId: string) => {
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
    const sources = new Set<TaskTemplateSkillSource>();
    for (const tmpl of templates) {
      for (const s of tmpl.requiresSkills ?? []) sources.add(s.source);
      for (const s of tmpl.optionalSkills ?? []) sources.add(s.source);
    }
    return sources;
  }, [templates]);
  const useFetchUserKlavisServers = useToolStore((s) => s.useFetchUserKlavisServers);
  const useFetchLobehubSkillConnections = useToolStore((s) => s.useFetchLobehubSkillConnections);
  useFetchUserKlavisServers(requiredSources.has('klavis'));
  useFetchLobehubSkillConnections(requiredSources.has('lobehub'));

  if (!swrEnabled) return { mode: 'hidden' };
  if (!isInit || isLoading) return { mode: 'skeleton', skeletonCount: recommendationCount };
  if (templates.length === 0) return { mode: 'hidden' };

  return {
    mode: 'cards',
    onCreated: handleCreated,
    onDismiss: handleDismiss,
    onRefresh: handleRefresh,
    templates,
  };
}
