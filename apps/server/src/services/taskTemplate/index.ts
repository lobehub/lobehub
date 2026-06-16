import type {
  TaskTemplate,
  TaskTemplateConnector,
  TaskTemplateConnectorReference,
} from '@lobechat/const';
import {
  COMPOSIO_APP_TYPES,
  getComposioAppByIdentifier,
  getLobehubSkillProviderById,
  isInterestAreaKey,
  LOBEHUB_SKILL_PROVIDERS,
  TASK_TEMPLATE_CATEGORIES,
  TASK_TEMPLATE_ICONS,
  TASK_TEMPLATE_RECOMMEND_COUNT,
  TASK_TEMPLATE_RECOMMEND_MAX_COUNT,
} from '@lobechat/const';

import { composioEnv } from '@/config/composio';
import { appEnv } from '@/envs/app';
import { MarketService } from '@/server/services/market';

export const ENABLED_TASK_TEMPLATE_CONNECTORS: TaskTemplateConnectorReference[] = (() => {
  const connectors: TaskTemplateConnectorReference[] = [];

  if (composioEnv.COMPOSIO_API_KEY) {
    connectors.push(
      ...COMPOSIO_APP_TYPES.map((app) => ({
        identifier: app.identifier,
        source: 'composio' as const,
      })),
    );
  }

  if (appEnv.MARKET_TRUSTED_CLIENT_ID && appEnv.MARKET_TRUSTED_CLIENT_SECRET) {
    connectors.push(
      ...LOBEHUB_SKILL_PROVIDERS.map((provider) => ({
        identifier: provider.id,
        source: 'lobehub' as const,
      })),
    );
  }

  return connectors;
})();

const clampRecommendationCount = (count?: number) =>
  Math.min(Math.max(1, count ?? TASK_TEMPLATE_RECOMMEND_COUNT), TASK_TEMPLATE_RECOMMEND_MAX_COUNT);

const TASK_TEMPLATE_CATEGORY_SET = new Set<string>(TASK_TEMPLATE_CATEGORIES);
const TASK_TEMPLATE_ICON_SET = new Set<string>(TASK_TEMPLATE_ICONS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTaskTemplateConnector = (value: unknown): value is TaskTemplateConnector => {
  if (!isRecord(value)) return false;
  if (
    typeof value.identifier !== 'string' ||
    (value.source !== 'composio' && value.source !== 'lobehub') ||
    typeof value.required !== 'boolean'
  ) {
    return false;
  }

  return value.source === 'lobehub'
    ? !!getLobehubSkillProviderById(value.identifier)
    : !!getComposioAppByIdentifier(value.identifier);
};

const isTaskTemplate = (value: unknown): value is TaskTemplate => {
  if (!isRecord(value)) return false;

  const interests = value.interests;
  const connectors = value.connectors;

  return (
    typeof value.category === 'string' &&
    TASK_TEMPLATE_CATEGORY_SET.has(value.category) &&
    Array.isArray(connectors) &&
    connectors.every(isTaskTemplateConnector) &&
    typeof value.cronPattern === 'string' &&
    typeof value.description === 'string' &&
    (value.icon === undefined ||
      (typeof value.icon === 'string' && TASK_TEMPLATE_ICON_SET.has(value.icon))) &&
    Number.isInteger(value.id) &&
    typeof value.identifier === 'string' &&
    typeof value.instruction === 'string' &&
    Array.isArray(interests) &&
    interests.every((interest) => typeof interest === 'string' && isInterestAreaKey(interest)) &&
    typeof value.title === 'string'
  );
};

export class TaskTemplateService {
  private marketService: MarketService;

  constructor(private userId: string) {
    this.marketService = new MarketService({ userInfo: { userId } });
  }

  async listDailyRecommend(
    interestKeys: string[],
    options: {
      count?: number;
      enabledConnectors?: readonly TaskTemplateConnectorReference[];
      excludeIds?: number[];
      locale?: string;
      refreshSeed?: string;
    } = {},
  ): Promise<TaskTemplate[]> {
    try {
      const result = await this.marketService.market.taskTemplates.getTaskTemplateRecommendations({
        count: clampRecommendationCount(options.count),
        enabledConnectors: options.enabledConnectors ? [...options.enabledConnectors] : undefined,
        excludeIds: options.excludeIds,
        interestKeys,
        locale: options.locale,
        refreshSeed: options.refreshSeed,
      });

      if (!Array.isArray(result.items)) {
        console.error('[taskTemplate:listDailyRecommend] Market recommendations returned no items');
        return [];
      }

      const items = result.items.filter(isTaskTemplate);
      if (items.length !== result.items.length) {
        console.error(
          '[taskTemplate:listDailyRecommend] Market recommendations returned malformed items',
        );
      }

      return items;
    } catch (error) {
      console.error('[taskTemplate:listDailyRecommend] Market recommendations failed', error);
      return [];
    }
  }
}
