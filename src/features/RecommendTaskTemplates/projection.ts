import type {
  TaskTemplate,
  TaskTemplateConnector,
  TaskTemplateConnectorSource,
} from '@lobechat/const';

import type { AppLocalStorage } from '@/libs/replica';
import { cacheScope, defineReplica, replicaKeys } from '@/libs/replica';

import { TASK_TEMPLATE_DAILY_RECOMMEND_REPLICA } from './const';
import { getProviderMeta } from './providerMeta';

export interface DailyRecommendParams {
  count: number;
  /**
   * Resolved interests, `null` while the user state is still initializing. Not
   * part of the entry or sync key: the persisted row paints before interests
   * resolve, and an interest edit refetches through `revalidateReplica`.
   */
  interestKeys: string[] | null;
  locale: string;
  /** Session refresh seed ('' = the day's default batch). */
  refreshSeed: string;
}

export const dailyRecommendKey = ({
  count,
  locale,
  refreshSeed,
}: Pick<DailyRecommendParams, 'count' | 'locale' | 'refreshSeed'>) =>
  [refreshSeed, count, locale].join('\u0000');

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null;

const isTaskTemplateConnectorSource = (value: unknown): value is TaskTemplateConnectorSource =>
  value === 'composio' || value === 'lobehub';

const isTaskTemplateConnector = (value: unknown): value is TaskTemplateConnector => {
  if (!isRecord(value)) return false;
  if (typeof value.identifier !== 'string') return false;
  if (!isTaskTemplateConnectorSource(value.source)) return false;
  return (
    typeof value.required === 'boolean' &&
    Boolean(getProviderMeta({ identifier: value.identifier, source: value.source }))
  );
};

/**
 * v2.2.6 returned legacy recommendation rows before `connectors` and text fields existed.
 * Drop legacy rows from version-skewed self-host servers so they cannot crash the home screen.
 */
const isTaskTemplateRecommendation = (value: unknown): value is TaskTemplate => {
  if (!isRecord(value)) return false;
  return (
    typeof value.category === 'string' &&
    Array.isArray(value.connectors) &&
    value.connectors.every(isTaskTemplateConnector) &&
    typeof value.cronPattern === 'string' &&
    typeof value.description === 'string' &&
    typeof value.id === 'number' &&
    typeof value.identifier === 'string' &&
    typeof value.instruction === 'string' &&
    Array.isArray(value.interests) &&
    typeof value.title === 'string'
  );
};

/** Treat non-array payloads as empty and drop rows the cards cannot render. */
export const normalizeTaskTemplateRecommendations = (templates: unknown): TaskTemplate[] =>
  Array.isArray(templates) ? templates.filter(isTaskTemplateRecommendation) : [];

/**
 * Continues the persisted row shape the SWR key carried as
 * `taskTemplate:listDailyRecommend:v2` (connectors + text fields). Bump it when
 * the row shape changes incompatibly; older rows then never hydrate.
 */
const DAILY_RECOMMEND_VERSION = 2;

/**
 * Home / empty-state task-template recommendations, one entry per refresh
 * seed + count + locale. localStorage so the home cards paint on the first
 * frame of a reload; every refresh mints a seed, so old rows are evicted past
 * the cap.
 *
 * The name deliberately matches no `CACHE_TIERS` pattern (`taskTemplate:`), so
 * the replica's SWR sync key is never persisted a second time by the SWR tier.
 */
export const dailyRecommendResource = defineReplica<DailyRecommendParams, TaskTemplate[]>({
  key: dailyRecommendKey,
  name: TASK_TEMPLATE_DAILY_RECOMMEND_REPLICA,
  persist: { maxEntries: 10 },
  storage: 'localStorage',
  // Interests stay out of the sync key (see `DailyRecommendParams.interestKeys`).
  syncKey: (params) =>
    replicaKeys.sync(
      TASK_TEMPLATE_DAILY_RECOMMEND_REPLICA,
      DAILY_RECOMMEND_VERSION,
      cacheScope.get(),
      dailyRecommendKey(params),
      { count: params.count, locale: params.locale, refreshSeed: params.refreshSeed },
    ),
  version: DAILY_RECOMMEND_VERSION,
});

/**
 * The persisted recommendations of an entry, read synchronously from the
 * replica's own localStorage row. The replica hydrates asynchronously, after
 * the first paint; this lets that first frame show the cards, not a skeleton.
 */
export const peekDailyRecommendations = (
  params: DailyRecommendParams,
  scope: string,
): unknown[] | undefined => {
  if (!cacheScope.canHydrate?.()) return undefined;
  const storage = dailyRecommendResource.storage as AppLocalStorage<TaskTemplate[]> | undefined;
  const data = storage?.getSync?.({
    queryKey: dailyRecommendResource.storageKey(params),
    scope,
  })?.data;
  return Array.isArray(data) ? data : undefined;
};
