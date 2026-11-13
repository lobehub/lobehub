import type { LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import { resolveMarketUserContext } from '@/libs/trpc/lambda/middleware';
import { isTrustedClientEnabled } from '@/libs/trusted-client';
import { DiscoverService } from '@/server/services/discover';
import type { CloudMcpCaller } from '@/server/services/mcp/cloudTool';

import { resolveRequestFileService } from './requestFileService';

/**
 * The caller a signed-in request runs a cloud MCP tool as, the way
 * `market.callCloudMcpEndpoint` does: the user's Market identity, their stored
 * Market token when trusted-client auth is not configured, and their file
 * storage for media blocks. `undefined` when there is no Market credential.
 */
export const resolveRequestCloudMcpCaller = async (ctx: {
  marketAccessToken?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}): Promise<CloudMcpCaller | undefined> => {
  const { marketAccessToken, marketUserInfo } = await resolveMarketUserContext(ctx);

  // Without trusted-client auth the market knows the user only by their own token
  let userAccessToken: string | undefined;
  if (!isTrustedClientEnabled()) {
    const settings = await new UserModel(ctx.serverDB, ctx.userId).getUserSettings();
    userAccessToken = (settings?.market as { accessToken?: string } | undefined)?.accessToken;
    if (!userAccessToken) return undefined;
  }

  return {
    discoverService: new DiscoverService({
      accessToken: marketAccessToken,
      userInfo: marketUserInfo,
    }),
    fileService: resolveRequestFileService(ctx),
    userAccessToken,
  };
};
