import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

export const connectorProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // Credentials (OAuth tokens) are encrypted at rest — give the model a gatekeeper.
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      connectorModel: new ConnectorModel(ctx.serverDB, ctx.userId, wsId, gateKeeper),
      connectorToolModel: new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId),
      pluginModel: new PluginModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Writes: workspace mode requires at least the member role, gating viewers
// out (read-only role) while personal mode passes through unrestricted.
export const connectorWriteProcedure = connectorProcedure.use(
  requireWorkspaceRoleWhenScoped('member'),
);
