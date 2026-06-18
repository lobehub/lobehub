import { createHash } from 'node:crypto';

import type {
  TaskTemplate,
  TaskTemplateConnector,
  TaskTemplateConnectorReference,
} from '@lobechat/const';
import {
  COMPOSIO_APP_TYPES,
  getComposioAppByIdentifier,
  getLobehubConnectorProviderById,
  INTEREST_AREA_KEYS,
  LOBEHUB_CONNECTOR_PROVIDERS,
  TASK_TEMPLATE_CATEGORIES,
  TASK_TEMPLATE_ICONS,
  TASK_TEMPLATE_RECOMMEND_COUNT,
  TASK_TEMPLATE_RECOMMEND_MAX_COUNT,
} from '@lobechat/const';
import { z } from 'zod';

import { composioEnv } from '@/config/composio';
import { appEnv } from '@/envs/app';
import { isTrustedClientEnabled } from '@/libs/trusted-client';
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
      ...LOBEHUB_CONNECTOR_PROVIDERS.map((provider) => ({
        identifier: provider.id,
        source: 'lobehub' as const,
      })),
    );
  }

  return connectors;
})();

const clampRecommendationCount = (count?: number) =>
  Math.min(Math.max(1, count ?? TASK_TEMPLATE_RECOMMEND_COUNT), TASK_TEMPLATE_RECOMMEND_MAX_COUNT);

const getInstanceSeedScope = () =>
  process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_PRODUCTION_URL || appEnv.APP_URL;

export const createTaskTemplateRecommendationSeedKey = (
  userId: string,
  instanceSeedScope = getInstanceSeedScope(),
) =>
  createHash('sha256')
    .update(`task-template-recommendation:v1:${instanceSeedScope}:${userId}`)
    .digest('base64url');

const isCronNumber = (value: string, max: number) => {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 0 && parsed <= max;
};

const isCronStep = (value: string, max: number) => {
  if (!/^\*\/\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value.slice(2), 10);
  return parsed >= 1 && parsed <= max;
};

const isCronNumberList = (value: string, max: number) =>
  value.split(',').every((item) => isCronNumber(item, max));

const isSupportedTaskTemplateCronPattern = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, weekday] = parts;
  if (
    !(minute === '*' || isCronNumberList(minute, 59) || isCronStep(minute, 59)) ||
    !(hour === '*' || isCronNumberList(hour, 23) || isCronStep(hour, 24))
  ) {
    return false;
  }
  if (dayOfMonth !== '*' || month !== '*') return false;

  return weekday === '*' || isCronNumberList(weekday, 6);
};

const taskTemplateConnectorSchema: z.ZodType<TaskTemplateConnector> = z
  .object({
    identifier: z.string(),
    required: z.boolean(),
    source: z.enum(['composio', 'lobehub']),
  })
  .refine(
    (connector) =>
      connector.source === 'lobehub'
        ? !!getLobehubConnectorProviderById(connector.identifier)
        : !!getComposioAppByIdentifier(connector.identifier),
    { message: 'Unknown task template connector' },
  );

const taskTemplateSchema: z.ZodType<TaskTemplate> = z.object({
  category: z.enum(TASK_TEMPLATE_CATEGORIES),
  connectors: z.array(taskTemplateConnectorSchema),
  cronPattern: z.string().refine(isSupportedTaskTemplateCronPattern, {
    message: 'Unsupported task template cron pattern',
  }),
  description: z.string(),
  icon: z.enum(TASK_TEMPLATE_ICONS).optional(),
  id: z.number().int(),
  identifier: z.string(),
  instruction: z.string(),
  interests: z.array(z.enum(INTEREST_AREA_KEYS)),
  title: z.string(),
});

const taskTemplateRecommendationEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
});

const parseTaskTemplateRecommendations = (value: unknown): TaskTemplate[] => {
  const envelope = taskTemplateRecommendationEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new Error('Market recommendations returned no items array');
  }

  const items = z.array(taskTemplateSchema).safeParse(envelope.data.items);
  if (!items.success) {
    throw new Error('Market recommendations returned malformed items');
  }

  return items.data;
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
        ...(isTrustedClientEnabled()
          ? {}
          : { seedKey: createTaskTemplateRecommendationSeedKey(this.userId) }),
      });

      return parseTaskTemplateRecommendations(result);
    } catch (error) {
      console.error('[taskTemplate:listDailyRecommend] Market recommendations failed', error);
      throw error;
    }
  }
}
