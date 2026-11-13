import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
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
  // Visibility-aware: decides whether the caller may run a call as an agent.
  const agentModel = new AgentModel(ctx.serverDB, ctx.userId, wsId);
  const connectorModel = new ConnectorModel(ctx.serverDB, ctx.userId, wsId);
  const composioService = new ComposioService({
    db: ctx.serverDB,
    userId: ctx.userId,
    workspaceId: wsId,
  });
  return opts.next({
    ctx: { ...ctx, agentModel, composioClient, composioService, connectorModel },
  });
});

export const composioToolsRouter = router({
  executeAction: composioProcedure
    .input(
      z.object({
        /** The agent the call runs for (its agent-owned connection first). */
        agentId: z.string().optional(),
        identifier: z.string(),
        toolArgs: z.record(z.string(), z.unknown()).optional(),
        toolSlug: z.string(),
        /**
         * The conversation the call belongs to. A private agent's own topic
         * lets it use its owner's private Composio connection, as the server
         * runtime does; without it the call resolves the workspace's shared
         * connections only.
         */
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const notFound = () =>
        new TRPCError({
          code: 'NOT_FOUND',
          message: `No Composio connection found for "${input.identifier}".`,
        });

      // The agent comes from the client, and an agent's own rows
      // (`agent_id = agentId`) are scoped by workspace only: a teammate who
      // kept the id of an agent made private since would otherwise run its
      // agent-owned Composio account. Only an agent the caller can see may be
      // resolved, as a connector call checks (`resolveConnectorForRun`); any
      // other id reads as not found.
      if (input.agentId && !(await ctx.agentModel.existsById(input.agentId))) throw notFound();

      // Resolve the connected account server-side, never from a client-supplied
      // connectedAccountId (that would let a user drive another user's
      // connection), and through the resolver the agent runtime uses, in the
      // conversation the call came from: it only serves a connector that run
      // may use (the workspace's shared ones, plus the owner's private ones in
      // their private agent's own direct topic — proven in SQL, so naming a
      // topic the caller does not own widens nothing), and never the plugin
      // mirror of a connector row it left out. `ownerUserId` is the Composio
      // entity that linked the account, not the caller.
      const account = await ctx.composioService.resolveComposioAccount(input.identifier, {
        agentId: input.agentId,
        topicId: input.topicId,
      });
      if (!account) throw notFound();
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
