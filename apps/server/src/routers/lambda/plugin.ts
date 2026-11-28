import { type LobeTool } from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { PluginModel } from '@/database/models/plugin';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';
import { redactForeignComposioLinks } from './_helpers/composioProjection';

const pluginProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: { pluginModel: new PluginModel(ctx.serverDB, ctx.userId, wsId) },
  });
});

/**
 * Legacy `user_installed_plugins` rows: read and remove only. New MCP installs
 * are written to `user_connectors` through `connector.create`, and connection
 * repair goes through the connector migration/update paths.
 */

export const pluginRouter = router({
  getPlugins: wsCompatProcedure.use(serverDatabase).query(async ({ ctx }): Promise<LobeTool[]> => {
    const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

    return redactForeignComposioLinks(await pluginModel.query({ forClient: true }), ctx);
  }),

  removePlugin: pluginProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.pluginModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!target) return;
      assertWorkspaceRowManageable(ctx, target.userId, 'plugin');
      return ctx.pluginModel.delete(input.id);
    }),
});

export type PluginRouter = typeof pluginRouter;
