import type { TaskTemplate, TaskTemplateSkillSource } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_COUNT } from '@lobechat/const';

import { composioEnv } from '@/config/composio';
import { appEnv } from '@/envs/app';
import { MarketService } from '@/server/services/market';

export const ENABLED_SKILL_SOURCES: ReadonlySet<TaskTemplateSkillSource> = (() => {
  const sources = new Set<TaskTemplateSkillSource>();
  if (composioEnv.COMPOSIO_API_KEY) sources.add('composio');
  if (appEnv.MARKET_TRUSTED_CLIENT_ID && appEnv.MARKET_TRUSTED_CLIENT_SECRET) {
    sources.add('lobehub');
  }
  return sources;
})();

interface TaskTemplateRecommendationInput {
  count?: number;
  enabledSkillSources?: TaskTemplateSkillSource[];
  excludeIds?: number[];
  interestKeys: string[];
  locale?: string;
  refreshSeed?: string;
}

interface TaskTemplateRecommendationResponse {
  items: TaskTemplate[];
}

interface MarketTaskTemplatesClient {
  getTaskTemplateRecommendations: (
    input: TaskTemplateRecommendationInput,
  ) => Promise<TaskTemplateRecommendationResponse>;
}

interface MarketSDKWithTaskTemplates {
  taskTemplates?: MarketTaskTemplatesClient;
}

let hasLoggedMissingTaskTemplateSDK = false;

export class TaskTemplateService {
  private marketService: MarketService;

  constructor(private userId: string) {
    this.marketService = new MarketService({ userInfo: { userId } });
  }

  async listDailyRecommend(
    interestKeys: string[],
    options: {
      count?: number;
      enabledSkillSources?: ReadonlySet<TaskTemplateSkillSource>;
      excludeIds?: number[];
      locale?: string;
      refreshSeed?: string;
    } = {},
  ): Promise<TaskTemplate[]> {
    const taskTemplatesClient = (this.marketService.market as unknown as MarketSDKWithTaskTemplates)
      .taskTemplates;

    if (!taskTemplatesClient?.getTaskTemplateRecommendations) {
      if (!hasLoggedMissingTaskTemplateSDK) {
        console.error('[taskTemplate:listDailyRecommend] Market taskTemplates SDK is unavailable');
        hasLoggedMissingTaskTemplateSDK = true;
      }
      return [];
    }

    try {
      const result = await taskTemplatesClient.getTaskTemplateRecommendations({
        count: options.count ?? TASK_TEMPLATE_RECOMMEND_COUNT,
        enabledSkillSources: options.enabledSkillSources
          ? [...options.enabledSkillSources]
          : undefined,
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
