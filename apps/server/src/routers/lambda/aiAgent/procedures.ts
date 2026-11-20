import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { AiChatService } from '@/server/services/aiChat';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';

export const aiAgentBaseProcedure = wsCompatProcedure.use(serverDatabase);

export const aiAgentProcedure = aiAgentBaseProcedure.use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  // Read market accessToken from user_settings.market so server-side agent runtime
  // can authenticate with the Market API for creds operations.
  let marketAccessToken: string | undefined;
  try {
    const userModel = new UserModel(ctx.serverDB!, ctx.userId);
    const settings = await userModel.getUserSettings();
    marketAccessToken = (settings?.market as any)?.accessToken;
  } catch {
    // non-fatal — MarketService will fall back to trustedClientToken
  }

  return opts.next({
    ctx: {
      agentRuntimeService: new AgentRuntimeService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, {
        marketAccessToken,
        withholdGatewayToken:
          ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes),
        workspaceId: wsId,
      }),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId, wsId),
      heterogeneousAgentService: new HeterogeneousAgentService(ctx.serverDB, ctx.userId, {
        workspaceId: wsId,
      }),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Dedicated procedure for hetero-agent callbacks. Narrow operation tokens are
// re-authorized against durable operation state; pre-deploy operation tokens and
// normal user OIDC tokens go through the legacy ownership guards.
export const heteroAgentProcedure = heteroAuthedProcedure.use(serverDatabase);

export const aiAgentWriteProcedure = aiAgentProcedure.use(withScopedPermission('message:create'));
