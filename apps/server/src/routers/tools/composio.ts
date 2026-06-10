import { z } from 'zod';

import { getComposioClient } from '@/libs/composio';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { MCPService } from '@/server/services/mcp';

const composioProcedure = authedProcedure.use(async (opts) => {
  const composioClient = getComposioClient();
  return opts.next({ ctx: { ...opts.ctx, composioClient } });
});

export const composioToolsRouter = router({
  executeAction: composioProcedure
    .input(
      z.object({
        connectedAccountId: z.string(),
        toolArgs: z.record(z.unknown()).optional(),
        toolSlug: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await (ctx.composioClient.tools as any).execute(input.toolSlug, {
        arguments: input.toolArgs || {},
        connectedAccountId: input.connectedAccountId,
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
      const response = await (ctx.composioClient.tools as any).get(ctx.userId, {
        toolkits: [input.appSlug],
      });

      const items = response?.items || response || [];
      const tools = Array.isArray(items)
        ? items.map((tool: any) => ({
            description: tool.description || '',
            inputSchema: tool.parameters ||
              tool.inputSchema || {
                properties: {},
                type: 'object',
              },
            name: tool.name || tool.slug || '',
          }))
        : [];

      return { tools };
    }),
});
