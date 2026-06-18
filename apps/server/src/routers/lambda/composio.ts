import { type ToolManifest } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getServerComposioAuthConfigId } from '@/config/composio';
import { PluginModel } from '@/database/models/plugin';
import { getComposioClient } from '@/libs/composio';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const composioProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const client = getComposioClient();
  const pluginModel = new PluginModel(opts.ctx.serverDB, opts.ctx.userId);

  return opts.next({
    ctx: { ...opts.ctx, composioClient: client, pluginModel },
  });
});

export const composioRouter = router({
  createConnection: composioProcedure
    .input(
      z.object({
        appSlug: z.string(),
        identifier: z.string(),
        label: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { appSlug, identifier, label } = input;
      const { userId } = ctx;

      const callbackUrl = `${process.env.APP_URL || process.env.NEXTAUTH_URL || ''}/api/composio/oauth/callback`;

      // Prefer a pre-configured auth config (e.g. a custom/white-label config
      // created in the Composio dashboard), pinned per toolkit via env. Falls
      // back to discovering an existing config for this toolkit, and finally to
      // auto-creating a Composio-managed one.
      let authConfigId = getServerComposioAuthConfigId(identifier);
      if (!authConfigId) {
        const authConfigs = await (ctx.composioClient.authConfigs as any).list();
        let authConfig = authConfigs?.items?.find(
          (c: any) => c.toolkit?.slug?.toLowerCase() === appSlug.toLowerCase(),
        );
        if (!authConfig) {
          authConfig = await (ctx.composioClient.authConfigs as any).create(appSlug, {
            name: appSlug,
            type: 'use_composio_managed_auth',
          });
        }
        authConfigId = authConfig.id;
      }

      if (!authConfigId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to resolve a Composio auth config for "${appSlug}".`,
        });
      }

      // Composio-managed OAuth auth configs no longer support `initiate`; use
      // `link` (POST /api/v3/connected_accounts/link) to get the redirect URL.
      const connReq = await (ctx.composioClient.connectedAccounts as any).link(
        userId,
        authConfigId,
        { callbackUrl },
      );

      let rawTools: any[] = [];
      try {
        const toolsResp = await (ctx.composioClient.tools as any).getRawComposioTools({
          toolkits: [appSlug],
        });
        rawTools = toolsResp?.items || toolsResp || [];
      } catch {
        // tools may not be available before auth
      }

      const manifest: ToolManifest = {
        api: Array.isArray(rawTools)
          ? rawTools.map((tool: any) => ({
              description: tool.description || '',
              name: tool.slug || tool.name || '',
              parameters: tool.inputParameters ||
                tool.inputSchema || {
                  properties: {},
                  type: 'object',
                },
            }))
          : [],
        identifier,
        meta: {
          avatar: '🔌',
          description: `Composio: ${label}`,
          title: label,
        },
        type: 'default',
      };

      await ctx.pluginModel.create({
        customParams: {
          composio: {
            appSlug,
            authConfigId,
            connectedAccountId: connReq.id,
            redirectUrl: connReq.redirectUrl,
            status: 'PENDING',
          },
        },
        identifier,
        manifest,
        source: 'composio',
        type: 'plugin',
      });

      return {
        authConfigId,
        connectedAccountId: connReq.id,
        identifier,
        redirectUrl: connReq.redirectUrl,
      };
    }),

  deleteConnection: composioProcedure
    .input(
      z.object({
        connectedAccountId: z.string(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await (ctx.composioClient.connectedAccounts as any).delete(input.connectedAccountId);
      } catch (error) {
        console.warn('[Composio] Failed to delete remote connection:', error);
      }

      await ctx.pluginModel.delete(input.identifier);

      return { success: true };
    }),

  getComposioPlugins: composioProcedure.query(async ({ ctx }) => {
    const allPlugins = await ctx.pluginModel.query();
    return allPlugins.filter((plugin) => plugin.customParams?.composio);
  }),

  getConnection: composioProcedure
    .input(
      z.object({
        connectedAccountId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const account = await (ctx.composioClient.connectedAccounts as any).get(
          input.connectedAccountId,
        );
        return {
          appSlug: account?.toolkit?.slug || '',
          connectedAccountId: input.connectedAccountId,
          error: undefined as 'AUTH_ERROR' | undefined,
          status: (account?.status || 'PENDING') as string,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isAuthError = errorMessage.includes('401') || errorMessage.includes('Unauthorized');

        if (isAuthError) {
          return {
            appSlug: '',
            connectedAccountId: input.connectedAccountId,
            error: 'AUTH_ERROR' as const,
            status: 'FAILED',
          };
        }
        throw error;
      }
    }),

  removeComposioPlugin: composioProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.pluginModel.delete(input.identifier);
      return { success: true };
    }),

  updateComposioPlugin: composioProcedure
    .input(
      z.object({
        appSlug: z.string(),
        authConfigId: z.string(),
        connectedAccountId: z.string(),
        identifier: z.string(),
        label: z.string(),
        redirectUrl: z.string().optional(),
        status: z.string(),
        tools: z.array(
          z.object({
            description: z.string().optional(),
            inputSchema: z.any().optional(),
            name: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const {
        identifier,
        label,
        appSlug,
        authConfigId,
        connectedAccountId,
        tools,
        status,
        redirectUrl,
      } = input;

      const existingPlugin = await ctx.pluginModel.findById(identifier);

      const manifest: ToolManifest = {
        api: tools.map((tool) => ({
          description: tool.description || '',
          name: tool.name,
          parameters: tool.inputSchema || { properties: {}, type: 'object' },
        })),
        identifier,
        meta: existingPlugin?.manifest?.meta || {
          avatar: '🔌',
          description: `Composio: ${label}`,
          title: label,
        },
        type: 'default',
      };

      const customParams = {
        composio: { appSlug, authConfigId, connectedAccountId, redirectUrl, status },
      };

      if (existingPlugin) {
        await ctx.pluginModel.update(identifier, { customParams, manifest });
      } else {
        await ctx.pluginModel.create({
          customParams,
          identifier,
          manifest,
          source: 'composio',
          type: 'plugin',
        });
      }

      return { savedCount: tools.length };
    }),
});

export type ComposioRouter = typeof composioRouter;
