import { type LobeTool } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
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
 * Legacy `user_installed_plugins` rows: read, update and remove only. New MCP
 * installs are written to `user_connectors` through `connector.create`.
 */
/**
 * `customParams.composio` (a Composio account and the member it runs as) is
 * server-owned: only the Composio connect flow writes it. Every member reads
 * the workspace's account ids from the projection, so a client-written block
 * could forge a "legacy" mirror of a teammate's private connection under any
 * identifier and run it. An update drops the client's block unless the row
 * already has a server-written one, which is kept instead.
 */
const withServerComposio = (
  clientParams: unknown,
  stored?: { composio?: unknown } | null,
): Record<string, unknown> | undefined => {
  if (!clientParams || typeof clientParams !== 'object') return clientParams as undefined;
  const { composio: _client, ...rest } = clientParams as Record<string, unknown>;
  return stored?.composio === undefined ? rest : { ...rest, composio: stored.composio };
};

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
        customParams:
          input.customParams === undefined
            ? undefined
            : withServerComposio(input.customParams, target.customParams),
        manifest: input.manifest,
        settings: input.settings,
      });
    }),
});

export type PluginRouter = typeof pluginRouter;
