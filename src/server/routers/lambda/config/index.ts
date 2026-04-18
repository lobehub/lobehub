import { EdgeConfig } from '@lobechat/edge-config';
import debug from 'debug';

import { businessConfigEndpoints } from '@/business/server/lambda-routers/config';
import { getServerFeatureFlagsStateFromEdgeConfig } from '@/config/featureFlags';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { getServerDefaultAgentConfig, getServerGlobalConfig } from '@/server/globalConfig';
import {
  type GlobalBillboard,
  type GlobalBillboardItem,
  type GlobalRuntimeConfig,
} from '@/types/serverConfig';

const log = debug('config-router');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeBillboardItem = (raw: unknown): GlobalBillboardItem | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.title !== 'string') return null;
  if (typeof raw.description !== 'string') return null;
  return raw as unknown as GlobalBillboardItem;
};

const normalizeBillboard = (raw: unknown): GlobalBillboard | null => {
  if (!isObject(raw)) return null;
  if (typeof raw.slug !== 'string' || raw.slug.length === 0) return null;
  if (typeof raw.title !== 'string') return null;
  if (typeof raw.startAt !== 'string' || typeof raw.endAt !== 'string') return null;
  if (!Array.isArray(raw.items)) return null;

  const items = raw.items
    .map((item) => normalizeBillboardItem(item))
    .filter((item): item is GlobalBillboardItem => item !== null);

  return { ...(raw as unknown as GlobalBillboard), items };
};

const getActiveBillboard = async (): Promise<GlobalBillboard | null> => {
  if (!EdgeConfig.isEnabled()) return null;
  try {
    const data = await new EdgeConfig().getBillboards();
    if (!data) return null;
    const normalized = normalizeBillboard(data);
    if (!normalized) {
      log('[Billboard] EdgeConfig payload failed validation, ignoring:', data);
      return null;
    }
    return normalized;
  } catch (err) {
    log('[Billboard] Failed to read from EdgeConfig:', err);
    return null;
  }
};

export const configRouter = router({
  getDefaultAgentConfig: publicProcedure.query(async () => {
    return getServerDefaultAgentConfig();
  }),

  getGlobalConfig: publicProcedure.query(async ({ ctx }): Promise<GlobalRuntimeConfig> => {
    log('[GlobalConfig] Starting global config retrieval for user:', ctx.userId || 'anonymous');

    const [serverConfig, serverFeatureFlags, billboard] = await Promise.all([
      getServerGlobalConfig(),
      getServerFeatureFlagsStateFromEdgeConfig(ctx.userId || undefined),
      getActiveBillboard(),
    ]);

    log('[GlobalConfig] Server config retrieved');

    return { billboard, serverConfig, serverFeatureFlags };
  }),

  ...businessConfigEndpoints,
});
