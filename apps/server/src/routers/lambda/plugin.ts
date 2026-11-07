import { type LobeTool } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { PluginModel } from '@/database/models/plugin';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const pluginProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: { pluginModel: new PluginModel(ctx.serverDB, ctx.userId, wsId) },
  });
});

/**
 * Legacy `user_installed_plugins` rows: read, update and remove only. New MCP
 * installs are written to `user_connectors` through `connector.create`.
 */
export const pluginRouter = router({
  getPlugins: wsCompatProcedure.use(serverDatabase).query(async ({ ctx }): Promise<LobeTool[]> => {
    const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

    return pluginModel.query();
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

  updatePlugin: pluginProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        customParams: z.any().optional(),
        id: z.string(),
        manifest: z.any().optional(),
        settings: z.any().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.pluginModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found' });
      assertWorkspaceRowManageable(ctx, target.userId, 'plugin');

      return ctx.pluginModel.update(input.id, {
        customParams: input.customParams,
        manifest: input.manifest,
        settings: input.settings,
      });
    }),
});

export type PluginRouter = typeof pluginRouter;
