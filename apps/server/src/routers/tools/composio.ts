import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PluginModel } from '@/database/models/plugin';
import { getComposioClient } from '@/libs/composio';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MCPService } from '@/server/services/mcp';

const composioProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const composioClient = getComposioClient();
  const pluginModel = new PluginModel(opts.ctx.serverDB, opts.ctx.userId);
  return opts.next({ ctx: { ...opts.ctx, composioClient, pluginModel } });
});

export const composioToolsRouter = router({
  executeAction: composioProcedure
    .input(
      z.object({
        identifier: z.string(),
        toolArgs: z.record(z.unknown()).optional(),
        toolSlug: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve the connected account server-side from the caller's own plugin
      // record (PluginModel is user-scoped). Never trust a connectedAccountId
      // supplied by the client — that would let a user drive another user's
      // connection.
      const plugin = await ctx.pluginModel.findById(input.identifier);
      const connectedAccountId = plugin?.customParams?.composio?.connectedAccountId;

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
        userId: ctx.userId,
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
