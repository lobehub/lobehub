import {
  COMPOSIO_APP_TYPES,
  LOBEHUB_SKILL_PROVIDERS,
  TASK_TEMPLATE_RECOMMEND_COUNT,
  TASK_TEMPLATE_RECOMMEND_MAX_COUNT,
} from '@lobechat/const';
import type { TaskTemplate, TaskTemplateConnectorReference } from '@lobehub/market-sdk';

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

      return result.items;
    } catch (error) {
      console.error('[taskTemplate:listDailyRecommend] Market recommendations failed', error);
      return [];
    }
  }
}
