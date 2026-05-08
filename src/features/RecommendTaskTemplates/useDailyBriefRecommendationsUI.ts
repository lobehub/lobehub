import type { RecommendedTaskTemplate, TaskTemplateSkillSource } from '@lobechat/const';
import { useAnalytics } from '@lobehub/analytics/react';
import { App } from 'antd';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { taskTemplateService } from '@/services/taskTemplate';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { createRecommendationBatchId, getTaskTemplateListServedProperties } from './analytics';
import { useResolvedInterestKeys } from './useResolvedInterestKeys';

export type DailyBriefRecommendationsUIState =
  | { mode: 'hidden' }
  | { mode: 'skeleton' }
  | {
      mode: 'cards';
      onCreated: (templateId: string) => void;
      onDismiss: (templateId: string) => void;
      recommendationBatchId: string;
      templates: RecommendedTaskTemplate[];
      userInterestCount: number;
    };

export function useDailyBriefRecommendationsUI(): DailyBriefRecommendationsUIState {
  const { t } = useTranslation('taskTemplate');
  const { analytics } = useAnalytics();
  const { message } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin && !!enableAgentTask);

  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  const interestKeys = useResolvedInterestKeys();
  const swrKey = interestKeys ? [...interestKeys].sort().join(',') : '';
  const swrEnabled = isLogin && !!enableAgentTask && interestKeys !== null;
  const batchRef = useRef<
    | {
        id: string;
        served: boolean;
        swrKey: string;
      }
    | undefined
  >(undefined);

  const { data, isLoading, mutate } = useSWR(
    swrEnabled ? ['taskTemplate.listDailyRecommend', swrKey] : null,
    async () => taskTemplateService.listDailyRecommend(interestKeys ?? []),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const templates = useMemo(() => data?.data ?? [], [data]);

  if (templates.length > 0 && batchRef.current?.swrKey !== swrKey) {
    batchRef.current = {
      id: createRecommendationBatchId(),
      served: false,
      swrKey,
    };
  }

  const recommendationBatchId = batchRef.current?.id;
  const userInterestCount = interestKeys?.length ?? 0;

  useEffect(() => {
    const batch = batchRef.current;
    if (!analytics || !batch || batch.served || templates.length === 0) return;

    void analytics.track({
      name: 'task_template_list_served',
      properties: getTaskTemplateListServedProperties({
        recommendationBatchId: batch.id,
        templates,
        userInterestCount,
      }),
    });
    batch.served = true;
  }, [analytics, templates, userInterestCount]);

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
  if (!isInit || isLoading) return { mode: 'skeleton' };
  if (templates.length === 0) return { mode: 'hidden' };

  return {
    mode: 'cards',
    onCreated: handleCreated,
    onDismiss: handleDismiss,
    recommendationBatchId: recommendationBatchId ?? createRecommendationBatchId(),
    templates,
    userInterestCount,
  };
}
