import { createHash } from 'node:crypto';

import type {
  TaskTemplate,
  TaskTemplateConnector,
  TaskTemplateConnectorReference,
  TaskTemplateConnectorSource,
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
const MARKET_SKILL_SOURCE_SET = new Set<string>(['klavis', 'lobehub']);

const getInstanceSeedScope = () =>
  process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_PRODUCTION_URL || appEnv.APP_URL;

export const createTaskTemplateRecommendationSeedKey = (
  userId: string,
  instanceSeedScope = getInstanceSeedScope(),
) =>
  createHash('sha256')
    .update(`task-template-recommendation:v1:${instanceSeedScope}:${userId}`)
    .digest('base64url');

const isTaskTemplateCategory = (value: unknown): value is TaskTemplate['category'] =>
  typeof value === 'string' && TASK_TEMPLATE_CATEGORY_SET.has(value);

const isTaskTemplateIcon = (value: unknown): value is TaskTemplate['icon'] =>
  typeof value === 'string' && TASK_TEMPLATE_ICON_SET.has(value);

const isTaskTemplateInterest = (value: unknown): value is TaskTemplate['interests'][number] =>
  typeof value === 'string' && isInterestAreaKey(value);

const isTaskTemplateInterests = (value: unknown): value is TaskTemplate['interests'] =>
  Array.isArray(value) && value.every(isTaskTemplateInterest);

const isCronNumber = (value: string, max: number) => {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 0 && parsed <= max;
};

const isSupportedTaskTemplateCronPattern = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;

  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, weekday] = parts;
  if (!isCronNumber(minute, 59) || !isCronNumber(hour, 23)) return false;
  if (dayOfMonth !== '*' || month !== '*') return false;

  return weekday === '*' || isCronNumber(weekday, 6);
};

type MarketTaskTemplateSkillSource = 'klavis' | 'lobehub';

interface MarketTaskTemplateSkillDependency {
  skillProvider?: unknown;
  skillSource?: unknown;
}

interface MarketTaskTemplateItem {
  category?: unknown;
  connectors?: unknown;
  cronPattern?: unknown;
  description?: unknown;
  icon?: unknown;
  id?: unknown;
  identifier?: unknown;
  instruction?: unknown;
  interests?: unknown;
  optionalSkills?: unknown;
  requiresSkills?: unknown;
  title?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getConnectorSourceFromMarketSkillSource = (
  source: MarketTaskTemplateSkillSource,
): TaskTemplateConnectorSource => (source === 'lobehub' ? 'lobehub' : 'composio');

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

const normalizeMarketSkillDependency = (
  value: MarketTaskTemplateSkillDependency,
  required: boolean,
): TaskTemplateConnector | undefined => {
  if (
    typeof value.skillProvider !== 'string' ||
    typeof value.skillSource !== 'string' ||
    !MARKET_SKILL_SOURCE_SET.has(value.skillSource)
  ) {
    return;
  }

  const source = getConnectorSourceFromMarketSkillSource(
    value.skillSource as MarketTaskTemplateSkillSource,
  );
  const connector = {
    identifier: value.skillProvider,
    required,
    source,
  };

  return isTaskTemplateConnector(connector) ? connector : undefined;
};

const normalizeMarketSkillDependencies = (
  value: unknown,
  required: boolean,
): TaskTemplateConnector[] | undefined => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return;

  const connectors: TaskTemplateConnector[] = [];

  for (const item of value) {
    if (!isRecord(item)) return;
    const connector = normalizeMarketSkillDependency(item, required);
    if (!connector) return;
    connectors.push(connector);
  }

  return connectors;
};

const normalizeTaskTemplateConnectors = (value: unknown): TaskTemplateConnector[] | undefined => {
  if (value === undefined) return;
  if (!Array.isArray(value)) return;
  if (!value.every(isTaskTemplateConnector)) return;

  return value;
};

const normalizeTaskTemplate = (value: unknown): TaskTemplate | undefined => {
  if (!isRecord(value)) return;

  const template = value as MarketTaskTemplateItem;
  const connectors = normalizeTaskTemplateConnectors(template.connectors);
  if (template.connectors !== undefined && !connectors) return;

  const requiredConnectors = connectors
    ? connectors.filter((connector) => connector.required)
    : normalizeMarketSkillDependencies(template.requiresSkills, true);
  const optionalConnectors = connectors
    ? connectors.filter((connector) => !connector.required)
    : normalizeMarketSkillDependencies(template.optionalSkills, false);

  if (!requiredConnectors || !optionalConnectors) return;

  if (!isTaskTemplateCategory(template.category)) return;
  if (!isSupportedTaskTemplateCronPattern(template.cronPattern)) return;
  if (typeof template.description !== 'string') return;

  const icon = template.icon;
  if (icon !== undefined && !isTaskTemplateIcon(icon)) return;
  if (typeof template.id !== 'number' || !Number.isInteger(template.id)) return;
  if (typeof template.identifier !== 'string') return;
  if (typeof template.instruction !== 'string') return;
  if (!isTaskTemplateInterests(template.interests)) return;
  if (typeof template.title !== 'string') return;

  return {
    category: template.category,
    connectors: [...requiredConnectors, ...optionalConnectors],
    cronPattern: template.cronPattern,
    description: template.description,
    icon,
    id: template.id,
    identifier: template.identifier,
    instruction: template.instruction,
    interests: template.interests,
    title: template.title,
  };
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

      if (!Array.isArray(result.items)) {
        throw new Error('Market recommendations returned no items array');
      }

      const items = result.items
        .map((item) => normalizeTaskTemplate(item))
        .filter((item): item is TaskTemplate => !!item);
      if (items.length !== result.items.length) {
        throw new Error('Market recommendations returned malformed items');
      }

      return items;
    } catch (error) {
      console.error('[taskTemplate:listDailyRecommend] Market recommendations failed', error);
      throw error;
    }
  }
}
