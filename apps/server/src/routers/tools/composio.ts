import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';
import { getComposioClient } from '@/libs/composio';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MCPService } from '@/server/services/mcp';

// wsCompatProcedure (not authedProcedure): when a request carries X-Workspace-Id
// the models below resolve in that workspace and buildWorkspaceWhere drops the
// userId filter, so honoring the header without verifying workspace membership
// would let any signed-in user execute another workspace's connected account.
// The cloud override validates membership; the OSS stub is a passthrough.
const composioProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const composioClient = getComposioClient();
  // Workspace-scoped so a manual tool execution resolves the workspace-dimension
  // Composio connection (workspace_id = wsId) rather than only the personal one.
  // Personal mode (wsId undefined) falls back to `workspace_id IS NULL`.
  const wsId = ctx.workspaceId ?? undefined;
  const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, wsId);
  const connectorModel = new ConnectorModel(ctx.serverDB, ctx.userId, wsId);
  return opts.next({ ctx: { ...ctx, composioClient, connectorModel, pluginModel } });
});

export const composioToolsRouter = router({
  executeAction: composioProcedure
    .input(
      z.object({
        identifier: z.string(),
        toolArgs: z.record(z.string(), z.unknown()).optional(),
        toolSlug: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve the connected account server-side from the caller's own records
      // (models are user-scoped). Never trust a connectedAccountId supplied by
      // the client — that would let a user drive another user's connection.
      // Connector metadata first (new path); plugin customParams as fallback for
      // connections created before the connector projection existed.
      const [connector] = await ctx.connectorModel.queryByIdentifiers([input.identifier]);
      const connectorComposio = connector?.metadata?.composio;
      let connectedAccountId = connectorComposio?.connectedAccountId;
      // The Composio user entity that OWNS the account (linked it), NOT the
      // caller. In a workspace the resolved row may belong to another member;
      // passing the caller's id fails Composio's account/entity validation.
      // `linkedByUserId` tracks the true linker (diverges from the row creator
      // when a workspace owner reconnects a member's row); fall back to the row
      // creator for legacy rows without it.
      let ownerUserId: string | undefined = connectorComposio?.linkedByUserId ?? connector?.userId;
      if (!connectedAccountId) {
        const plugin = await ctx.pluginModel.findById(input.identifier);
        const pluginComposio = plugin?.customParams?.composio;
        connectedAccountId = pluginComposio?.connectedAccountId;
        ownerUserId = pluginComposio?.linkedByUserId ?? plugin?.userId;
      }

      if (!connectedAccountId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No Composio connection found for "${input.identifier}".`,
        });
      }

      const result = await (ctx.composioClient.tools as any).execute(input.toolSlug, {
        arguments: input.toolArgs || {},
        connectedAccountId,
        // Toolkit version resolves to "latest"; allow manual execution without a
        // pinned version (Composio otherwise throws ComposioToolVersionRequiredError).
        dangerouslySkipVersionCheck: true,
        userId: ownerUserId ?? ctx.userId,
      });

      if (!result) {
        return {
          content: 'Unknown error',
          state: { content: [{ text: 'Unknown error', type: 'text' }], isError: true },
          success: false,
        };
      }

      const data = result as any;
      const content = data?.data || data?.result || data;
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

      return await MCPService.processToolCallResult({
        content: [{ text: contentStr, type: 'text' }],
        isError: false,
      });
    }),

  getActions: publicProcedure.input(z.object({ appSlug: z.string() })).query(async ({ input }) => {
    const client = getComposioClient();
    const response = await (client.tools as any).getRawComposioTools({
      toolkits: [input.appSlug],
    });

    const items = response?.items || response || [];
    const tools = Array.isArray(items)
      ? items.map((tool: any) => ({
          description: tool.description || '',
          inputSchema: tool.inputParameters ||
            tool.inputSchema || {
              properties: {},
              type: 'object',
            },
          name: tool.slug || tool.name || '',
        }))
      : [];

    return { tools };
  }),

  listActions: composioProcedure
    .input(z.object({ appSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      // Use getRawComposioTools (raw tool defs with slug/inputParameters), NOT
      // tools.get() — the latter returns provider-wrapped (OpenAI-format) tools
      // whose name/params live under `.function`, so slug/name/inputSchema come
      // back empty and every tool collapses to the same `${identifier}____` name.
      const response = await (ctx.composioClient.tools as any).getRawComposioTools({
        toolkits: [input.appSlug],
      });

      const items = response?.items || response || [];
      const tools = Array.isArray(items)
        ? items.map((tool: any) => ({
            description: tool.description || '',
            inputSchema: tool.inputParameters ||
              tool.inputSchema || {
                properties: {},
                type: 'object',
              },
            name: tool.slug || tool.name || '',
          }))
        : [];

      return { tools };
    }),
});
