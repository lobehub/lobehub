import type { TaskTemplate, TaskTemplateConnectorSource } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_COUNT } from '@lobechat/const';
import { createNanoId } from '@lobechat/utils';
import { toast } from '@lobehub/ui';
import { useSessionStorageState } from 'ahooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useSingleton } from '@/hooks/useSingleton';
import { cacheScope } from '@/libs/replica';
import { taskTemplateService } from '@/services/taskTemplate';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import {
  dailyRecommendKey,
  type DailyRecommendParams,
  normalizeTaskTemplateRecommendations,
  peekDailyRecommendations,
} from './projection';
import {
  dailyRecommendErrorId,
  dailyRecommendReplica,
  useTaskTemplateRecommendationStore,
} from './recommendationStore';
import { useResolvedInterestKeys } from './useResolvedInterestKeys';

const REFRESH_SEED_STORAGE_KEY = 'lobehub:taskTemplate:refreshSeed';
const nextRefreshSeed = createNanoId(8);
const RECOMMENDATION_DEDUPE_INTERVAL = 10_000;

export type DailyBriefRecommendationsUIState =
  | { mode: 'hidden' }
  | { mode: 'skeleton'; skeletonCount: number }
  | {
      isValidating: boolean;
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

  const params: DailyRecommendParams | null = enabled
    ? { count: recommendationCount, interestKeys, locale, refreshSeed: refreshSeed ?? '' }
    : null;

  return { params, shouldFetch: enabled && interestKeys !== null };
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
  const { i18n, t } = useTranslation('common');
  const locale = i18n.resolvedLanguage || i18n.language;

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
  const { params, shouldFetch: canFetchRecommendations } = recommendationRequest;
  const key = params ? dailyRecommendKey(params) : undefined;
  const entry = useTaskTemplateRecommendationStore((s) =>
    key ? s.dailyRecommendMap[key] : undefined,
  );

  // The persisted row hydrates as soon as the user is known; the network read
  // waits for resolved interests (they are sent with the request). Several views
  // (home rail, its visibility probe, the task empty state) mount this hook:
  // the dedupe window lets one mounting shortly after another share its read.
  // `isPaused` holds the network read until the interests resolve, also when
  // the entry key changes (scope, locale, seed) before they do: the persisted
  // row still hydrates, and the read starts once they resolve (below).
  const interestsPendingRef = useRef(interestKeys === null);
  interestsPendingRef.current = interestKeys === null;
  const isPaused = useCallback(() => interestsPendingRef.current, []);
  const {
    error: syncError,
    isHydrated,
    isValidating,
  } = dailyRecommendReplica.useSync(params, {
    dedupingInterval: RECOMMENDATION_DEDUPE_INTERVAL,
    isPaused,
    revalidateIfStale: canFetchRecommendations,
    revalidateOnFocus: false,
    revalidateOnMount: canFetchRecommendations,
    revalidateOnReconnect: false,
  });
  // A failure of either the sync or the `fetch` below lands here.
  const scope = cacheScope.use();
  const storedError = useTaskTemplateRecommendationStore((s) =>
    key ? s.dailyRecommendErrorMap[dailyRecommendErrorId(scope, key)] : undefined,
  );
  const error = syncError ?? storedError;
  const waitedForInterestsRef = useRef(false);

  useEffect(() => {
    if (!key) {
      waitedForInterestsRef.current = false;
      return;
    }

    if (interestKeys === null) {
      waitedForInterestsRef.current = true;
      return;
    }

    if (!waitedForInterestsRef.current || !params) return;
    waitedForInterestsRef.current = false;
    // `fetch` joins a request already in flight for the entry, so every mounted
    // view resolving its interests in the same frame sends one request (a
    // `revalidate` per view would force one each).
    // A failure is stored by the slice effects (`dailyRecommendErrorMap`) and
    // logged through `error` below.
    dailyRecommendReplica.fetch(params).catch(() => {});
  }, [interestKeys, key, params]);

  useEffect(() => {
    if (error) console.error('[taskTemplate:listDailyRecommend]', error);
  }, [error]);

  // A refresh mints a new seed (a new entry): keep the previous batch on screen
  // until the new one lands — or after it fails — instead of dropping back to
  // the skeleton. Only the previous entry's key is remembered and its batch is
  // read from the store, which a scope switch clears, so another identity's
  // batch is never shown.
  const retainedKeyRef = useRef<string | undefined>(undefined);
  if (!key) retainedKeyRef.current = undefined;
  else if (entry) retainedKeyRef.current = key;
  const retainedKey = retainedKeyRef.current;
  const retained = useTaskTemplateRecommendationStore((s) =>
    key && retainedKey ? s.dailyRecommendMap[retainedKey] : undefined,
  );
  // Until the async hydrate settles, read the persisted row synchronously, so
  // a reload paints the cards on its first frame instead of the skeleton.
  const peeked = useMemo(
    () => (!isHydrated && params ? peekDailyRecommendations(params, scope) : undefined),
    [isHydrated, params, scope],
  );
  const shown = entry ?? (peeked as TaskTemplate[] | undefined) ?? retained;
  // Card actions target the entry whose batch is on screen.
  const shownKey = entry || peeked ? key : retained ? retainedKey : undefined;

  // Cards painted from the peek have no store entry yet: seed it (memory only,
  // the row is already persisted) so an action in that window lands. A later
  // hydrate only fills an empty entry, so it never overwrites the result.
  const peekedRef = useRef(peeked);
  peekedRef.current = peeked;
  const seedPeeked = useCallback((target: string) => {
    const batch = peekedRef.current;
    if (!batch || useTaskTemplateRecommendationStore.getState().dailyRecommendMap[target]) return;
    dailyRecommendReplica.update(target, () => normalizeTaskTemplateRecommendations(batch), {
      persist: false,
    });
  }, []);

  // Cards created / dismissed from the retained batch while a refresh is in
  // flight: the refreshing entry may return them again. Keyed by the
  // refreshing entry (scope + key → template ids):
  // - `pendingRemovals`: dismissals the server has not confirmed yet, only
  //   hidden on screen, so a refused dismiss leaves nothing to undo;
  // - `confirmedRemovals`: created cards and confirmed dismissals, removed from
  //   the refreshing entry (and its persisted row) as soon as it holds them.
  const pendingRemovals = useSingleton(() => new Map<string, Set<number>>());
  const confirmedRemovals = useSingleton(() => new Map<string, Set<number>>());
  const [, bumpPendingRemovals] = useReducer((count: number) => count + 1, 0);
  const refreshingId = key ? `${scope}\u0000${key}` : undefined;
  const toggleRemoval = (
    map: Map<string, Set<number>>,
    id: string,
    templateId: number,
    add: boolean,
  ) => {
    const ids = map.get(id) ?? new Set<number>();
    if (add) ids.add(templateId);
    else ids.delete(templateId);
    if (ids.size > 0) map.set(id, ids);
    else map.delete(id);
  };
  const applyConfirmedRemovals = useCallback(
    (target: string, id: string) => {
      const ids = confirmedRemovals.get(id);
      const current = useTaskTemplateRecommendationStore.getState().dailyRecommendMap[target];
      if (!ids || !current) return;
      confirmedRemovals.delete(id);
      if (!current.some((tmpl) => ids.has(tmpl?.id))) return;
      dailyRecommendReplica.update(target, (batch) =>
        batch
          ? normalizeTaskTemplateRecommendations(batch).filter((tmpl) => !ids.has(tmpl.id))
          : batch,
      );
    },
    [confirmedRemovals],
  );
  // Before paint, so a removed card never flashes back in.
  useLayoutEffect(() => {
    if (key && refreshingId && entry) applyConfirmedRemovals(key, refreshingId);
  }, [applyConfirmedRemovals, entry, key, refreshingId]);

  const handleRefresh = useCallback(() => {
    setRefreshSeed(nextRefreshSeed());
  }, [setRefreshSeed]);

  const handleCreated = useCallback(
    (templateId: number) => {
      if (!shownKey) return;
      seedPeeked(shownKey);
      dailyRecommendReplica.update(shownKey, (current) =>
        current
          ? normalizeTaskTemplateRecommendations(current).filter((tmpl) => tmpl.id !== templateId)
          : current,
      );
      if (!key || !refreshingId || shownKey === key) return;
      toggleRemoval(confirmedRemovals, refreshingId, templateId, true);
      applyConfirmedRemovals(key, refreshingId);
    },
    [applyConfirmedRemovals, confirmedRemovals, key, refreshingId, seedPeeked, shownKey],
  );

  const handleDismiss = useCallback(
    async (templateId: number) => {
      if (!shownKey) return;
      seedPeeked(shownKey);
      if (!useTaskTemplateRecommendationStore.getState().dailyRecommendMap[shownKey]) return;
      // A dismiss on the retained batch while a refresh is in flight.
      const carriedTo = key && refreshingId && shownKey !== key ? refreshingId : undefined;
      if (carriedTo) {
        toggleRemoval(pendingRemovals, carriedTo, templateId, true);
        bumpPendingRemovals();
      }
      try {
        // Rolls the card back if the server refuses.
        await dailyRecommendReplica.optimistic(
          shownKey,
          // A hydrated row may still hold rows the cards dropped as malformed.
          (current) =>
            normalizeTaskTemplateRecommendations(current).filter((tmpl) => tmpl.id !== templateId),
          () => taskTemplateService.dismiss(templateId),
        );
        if (carriedTo && key) {
          toggleRemoval(confirmedRemovals, carriedTo, templateId, true);
          applyConfirmedRemovals(key, carriedTo);
        }
      } catch (error) {
        console.error('[taskTemplate:dismiss]', error);
        toast.error(t('taskTemplate.action.dismiss.error'));
      } finally {
        if (carriedTo) {
          toggleRemoval(pendingRemovals, carriedTo, templateId, false);
          bumpPendingRemovals();
        }
      }
    },
    [
      applyConfirmedRemovals,
      confirmedRemovals,
      key,
      pendingRemovals,
      refreshingId,
      seedPeeked,
      shownKey,
      t,
    ],
  );

  const hiddenIds = refreshingId ? pendingRemovals.get(refreshingId) : undefined;
  const templates = useMemo(() => {
    const normalized = normalizeTaskTemplateRecommendations(shown);
    return hiddenIds?.size ? normalized.filter((tmpl) => !hiddenIds.has(tmpl.id)) : normalized;
    // `hiddenIds` is mutated in place; its size (bumped on every change) is the dependency.
  }, [shown, hiddenIds, hiddenIds?.size]);
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
    hasRecommendationKey: Boolean(key),
    hasTemplates: templates.length > 0,
    isInit,
    // Nothing settled for this entry yet: its persisted row is still being read.
    isLoading: !isHydrated,
    isValidating,
    isWaitingForInterestsFetch: interestKeys !== null && waitedForInterestsRef.current,
  });
  // A failed refresh keeps the cards it already has; a failed first load hides.
  if (error && templates.length === 0) return { mode: 'hidden' };
  if (displayMode === 'hidden') return { mode: 'hidden' };
  if (displayMode === 'skeleton') return { mode: 'skeleton', skeletonCount: recommendationCount };

  return {
    isValidating,
    mode: 'cards',
    onCreated: handleCreated,
    onDismiss: handleDismiss,
    onRefresh: handleRefresh,
    templates,
  };
}
