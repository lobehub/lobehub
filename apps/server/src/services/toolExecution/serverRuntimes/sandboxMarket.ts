import type { SandboxStorageClaim } from '@lobechat/builtin-tool-cloud-sandbox';

import { MarketService } from '@/server/services/market';

import type { ToolExecutionContext } from '../types';

/** The runtime context supplies identity; tool arguments cannot select another operation. */
export const createSandboxMarketService = (
  context: ToolExecutionContext,
  accessToken: string | undefined,
  workspaceId: string | undefined,
  sandboxStorage: SandboxStorageClaim | null | undefined,
) => {
  if (!context.userId) throw new Error('userId is required for sandbox execution');
  return new MarketService({
    accessToken,
    userInfo: {
      sandboxOperation:
        context.operationId && context.topicId
          ? { operationId: context.operationId, topicId: context.topicId }
          : undefined,
      sandboxStorage,
      userId: context.userId,
      workspaceId,
    },
  });
};
