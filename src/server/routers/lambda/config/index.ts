import { EdgeConfig } from '@lobechat/edge-config';
import debug from 'debug';

import { businessConfigEndpoints } from '@/business/server/lambda-routers/config';
import { getServerFeatureFlagsStateFromEdgeConfig } from '@/config/featureFlags';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { getServerDefaultAgentConfig, getServerGlobalConfig } from '@/server/globalConfig';
import { type GlobalBillboard, type GlobalRuntimeConfig } from '@/types/serverConfig';

const log = debug('config-router');

const getActiveBillboard = async (): Promise<GlobalBillboard | null> => {
  if (!EdgeConfig.isEnabled()) return null;
  try {
    const data = await new EdgeConfig().getBillboards();
    if (!data) return null;
    return data as GlobalBillboard;
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
