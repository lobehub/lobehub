import type { TaskTemplate } from '@lobechat/const';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { taskTemplateService } from '@/services/taskTemplate';
import { createDevtools } from '@/store/middleware/createDevtools';

import {
  type DailyRecommendParams,
  dailyRecommendResource,
  normalizeTaskTemplateRecommendations,
} from './projection';

export const fetchDailyRecommendations = async ({
  count,
  interestKeys,
  locale,
  refreshSeed,
}: DailyRecommendParams): Promise<TaskTemplate[]> => {
  // The sync only runs once interests resolve (see `useDailyBriefRecommendationsUI`).
  if (!interestKeys) throw new Error('[taskTemplate:listDailyRecommend] interests not resolved');
  const result = await taskTemplateService.listDailyRecommend(interestKeys, {
    count,
    locale,
    refreshSeed: refreshSeed || undefined,
  });
  return normalizeTaskTemplateRecommendations(result?.data);
};

export interface TaskTemplateRecommendationStoreState {
  /**
   * `dailyRecommendErrorId(scope, key)` → the last read failure, cleared by a
   * success. Scoped, so one identity's failure never hides another's cards.
   * Covers reads started outside `useSync` (`slice.fetch`), whose failure the
   * sync's own `error` never sees.
   */
  dailyRecommendErrorMap: Record<string, unknown>;
  /** `dailyRecommendKey(params)` → the recommended templates. */
  dailyRecommendMap: Record<string, TaskTemplate[]>;
  dailyRecommendReplica: ReplicaState<TaskTemplate[]>;
}

export const initialTaskTemplateRecommendationState: TaskTemplateRecommendationStoreState = {
  dailyRecommendErrorMap: {},
  dailyRecommendMap: {},
  dailyRecommendReplica: createReplicaState(),
};

const devtools = createDevtools('taskTemplateRecommendation');

export const useTaskTemplateRecommendationStore =
  createWithEqualityFn<TaskTemplateRecommendationStoreState>()(
    devtools(() => initialTaskTemplateRecommendationState),
    shallow,
  );

export const dailyRecommendErrorId = (scope: string, key: string) => `${scope}\u0000${key}`;

const setError = (id: string, error: unknown) => {
  const { dailyRecommendErrorMap } = useTaskTemplateRecommendationStore.getState();
  if (dailyRecommendErrorMap[id] === error) return;
  const next = { ...dailyRecommendErrorMap };
  if (error === undefined) delete next[id];
  else next[id] = error;
  useTaskTemplateRecommendationStore.setState({ dailyRecommendErrorMap: next });
};

export const dailyRecommendReplica = createReplicaSlice(dailyRecommendResource, {
  actionPrefix: 'taskTemplate/dailyRecommend',
  effects: {
    onApplied: (_data, _params, { key, scope }) =>
      setError(dailyRecommendErrorId(scope, key), undefined),
    onError: (error, _params, { isActive, key, scope }) => {
      if (isActive && key) setError(dailyRecommendErrorId(scope, key), error);
    },
  },
  fetcher: fetchDailyRecommendations,
  get: useTaskTemplateRecommendationStore.getState,
  // A row persisted by an older or corrupted write is not a list: fetch instead.
  isHydratable: (cached) => Array.isArray(cached),
  set: useTaskTemplateRecommendationStore.setState,
  stateKey: 'dailyRecommendReplica',
  view: recordLens<TaskTemplateRecommendationStoreState, TaskTemplate[]>('dailyRecommendMap'),
});
