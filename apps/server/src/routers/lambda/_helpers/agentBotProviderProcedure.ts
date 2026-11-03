import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

/** Bot-provider reads: `ctx.agentBotProviderModel` scoped to the caller and active workspace. */
export const agentBotProviderProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      agentBotProviderModel: new AgentBotProviderModel(ctx.serverDB, ctx.userId, gateKeeper, wsId),
    },
  });
});

// Write variant gates viewers out of bot-provider mutations
// (create/update/delete + start/test connections). Reads keep the bare proc.
export const agentBotProviderProcedureWrite = agentBotProviderProcedure.use(
  withScopedPermission('agent:update'),
);
