import { type LobeTool } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertConnectorAllowed } from '@/server/services/connector/policy';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

/** A `customPlugin` is a member-defined tool; a `plugin` row is a marketplace install. */
const assertPluginAllowed = (identifier: string, type: 'customPlugin' | 'plugin' | string) =>
  assertConnectorAllowed({
    identifier,
    sourceType: type === 'customPlugin' ? 'custom' : 'marketplace',
  });

const pluginProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: { pluginModel: new PluginModel(ctx.serverDB, ctx.userId, wsId) },
  });
});

export const pluginRouter = router({
  createOrInstallPlugin: pluginProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        customParams: z.any().optional(),
        identifier: z.string(),
        manifest: z.any(),
        settings: z.any().optional(),
        type: z.enum(['plugin', 'customPlugin']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertPluginAllowed(input.identifier, input.type);
      const result = await ctx.pluginModel.findById(input.identifier);

      // if not exist, we should create the plugin
      if (!result) {
        const data = await ctx.pluginModel.create({
          customParams: input.customParams,
          identifier: input.identifier,
          manifest: input.manifest,
          settings: input.settings,
          type: input.type,
        });

        return data.identifier;
      }

      // or we can just update the plugin manifest — but only the creator (or a
      // workspace owner) may overwrite an existing row's manifest.
      assertWorkspaceRowManageable(ctx, result.userId, 'plugin');
      await ctx.pluginModel.update(input.identifier, {
        ...(input.customParams?.oauthConnectorId && { customParams: input.customParams }),
        manifest: input.manifest,
      });
    }),

  createPlugin: pluginProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        customParams: z.any().optional(),
        identifier: z.string(),
        manifest: z.any().optional(),
        type: z.enum(['plugin', 'customPlugin']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertPluginAllowed(input.identifier, input.type);
      const data = await ctx.pluginModel.create({
        customParams: input.customParams,
        identifier: input.identifier,
        manifest: input.manifest,
        type: input.type,
      });

      return data.identifier;
    }),

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
      if (target.customParams?.oauthConnectorId) {
        return ctx.serverDB.transaction(async (tx) => {
          const connectorModel = new ConnectorModel(tx, ctx.userId, ctx.workspaceId ?? undefined);
          // Managed lifecycle checks need metadata, which the public projection omits.
          // No gatekeeper is supplied: uninstall neither decrypts nor returns credentials.
          const connector = await connectorModel.findById(target.customParams!.oauthConnectorId!);
          if (
            connector &&
            connector.identifier === input.id &&
            connector.sourceType === 'marketplace' &&
            connector.metadata?.marketplaceOAuth === true
          ) {
            assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
            await connectorModel.delete(connector.id);
          }
          return new PluginModel(tx, ctx.userId, ctx.workspaceId ?? undefined).delete(input.id);
        });
      }
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
      await assertPluginAllowed(input.id, target.type);

      return ctx.pluginModel.update(input.id, {
        customParams: input.customParams,
        manifest: input.manifest,
        settings: input.settings,
      });
    }),
});

export type PluginRouter = typeof pluginRouter;
