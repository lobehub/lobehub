import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { getComposioClient, isComposioConnectedAccountNotFoundError } from '@/libs/composio';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ComposioService } from '@/server/services/composio';
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
  const connectorModel = new ConnectorModel(ctx.serverDB, ctx.userId, wsId);
  const composioService = new ComposioService({
    db: ctx.serverDB,
    userId: ctx.userId,
    workspaceId: wsId,
  });
  return opts.next({ ctx: { ...ctx, composioClient, composioService, connectorModel } });
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
      // Resolve the connected account server-side, never from a client-supplied
      // connectedAccountId (that would let a user drive another user's
      // connection), and through the resolver the agent runtime uses: it only
      // serves a connector this call may run (the workspace's shared ones, as
      // no conversation is named), and never the plugin mirror of a connector
      // row it left out — a connector its creator made private stays private
      // here too. `ownerUserId` is the Composio entity that linked the account,
      // not the caller.
      const account = await ctx.composioService.resolveComposioAccount(input.identifier, {});
      if (!account) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No Composio connection found for "${input.identifier}".`,
        });
      }
      const { connectedAccountId, connector, ownerUserId } = account;

      let result: unknown;
      try {
        result = await (ctx.composioClient.tools as any).execute(input.toolSlug, {
          arguments: input.toolArgs || {},
          connectedAccountId,
          // Toolkit version resolves to "latest"; allow manual execution without a
          // pinned version (Composio otherwise throws ComposioToolVersionRequiredError).
          dangerouslySkipVersionCheck: true,
          userId: ownerUserId,
        });
      } catch (error) {
        if (connector && isComposioConnectedAccountNotFoundError(error)) {
          try {
            await ctx.connectorModel
              .forRow(connector)
              .markComposioConnectionUnavailable(connector.id, connectedAccountId);
          } catch {
            // Preserve the remote execution error if the secondary health write fails.
          }
        }
        throw error;
      }

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
