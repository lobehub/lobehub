import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { ConnectorToolPermission } from '@/database/schemas';
import { getKlavisClient } from '@/libs/klavis';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MCPService } from '@/server/services/mcp';

/**
 * Klavis procedure with client initialized in context
 */
const klavisProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const klavisClient = getKlavisClient();

  return opts.next({
    ctx: { ...opts.ctx, klavisClient },
  });
});

/**
 * Klavis router for tools
 * Contains callTool and listTools which call external Klavis API
 */
export const klavisRouter = router({
  /**
   * Call a tool on a Klavis Strata server
   */
  callTool: klavisProcedure
    .input(
      z.object({
        /** Klavis server identifier (e.g. 'gmail', 'google-calendar') for precise permission lookup */
        identifier: z.string().optional(),
        serverUrl: z.string(),
        toolArgs: z.record(z.unknown()).optional(),
        toolName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ── Connector tool permission gate ────────────────────────────────────
      // Use identifier + toolName when available for a precise lookup (avoids
      // same-name collisions across connectors). Falls back to toolName-only
      // if identifier is absent (legacy callers).
      if (ctx.userId && ctx.serverDB) {
        const wsId = ctx.workspaceId ?? undefined;
        const connectorToolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId);
        let connectorTool:
          | Awaited<ReturnType<typeof connectorToolModel.findByToolName>>
          | undefined;

        if (input.identifier) {
          const connectorModel = new ConnectorModel(ctx.serverDB, ctx.userId, wsId);
          const [connector] = await connectorModel.queryByIdentifiers([input.identifier]);
          if (connector) {
            const tools = await connectorToolModel.queryByConnector(connector.id);
            connectorTool = tools.find((t) => t.toolName === input.toolName);
          }
        } else {
          connectorTool = await connectorToolModel.findByToolName(input.toolName);
        }

        if (connectorTool?.permission === ConnectorToolPermission.disabled) {
          const message =
            `The tool "${input.toolName}" has been disabled by the user and cannot be executed. ` +
            `Please inform the user that this tool is currently disabled. ` +
            `They can re-enable it in Settings > Connectors.`;
          return {
            content: message,
            state: { content: [{ text: message, type: 'text' }], isError: false },
            success: true,
          };
        }
      }
      // ── End permission gate ───────────────────────────────────────────────

      const response = await ctx.klavisClient.mcpServer.callTools({
        serverUrl: input.serverUrl,
        toolArgs: input.toolArgs,
        toolName: input.toolName,
      });

      // Handle error case
      if (!response.success || !response.result) {
        return {
          content: response.error || 'Unknown error',
          state: {
            content: [{ text: response.error || 'Unknown error', type: 'text' }],
            isError: true,
          },
          success: false,
        };
      }

      // Process the response using the common MCP tool call result processor
      const processedResult = await MCPService.processToolCallResult({
        content: (response.result.content || []) as any[],
        isError: response.result.isError,
      });

      return processedResult;
    }),

  /**
   * Get tools by server name (public endpoint, no auth required)
   */
  getTools: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const klavisClient = getKlavisClient();
      const response = await klavisClient.mcpServer.getTools(input.serverName as any);

      return {
        tools: response.tools,
      };
    }),

  /**
   * List tools available on a Klavis Strata server
   */
  listTools: klavisProcedure
    .input(
      z.object({
        serverUrl: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const response = await ctx.klavisClient.mcpServer.listTools({
        serverUrl: input.serverUrl,
      });

      return {
        tools: response.tools,
      };
    }),
});
