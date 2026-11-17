import {
  DESKTOP_STDIO_EXECUTION_KEY,
  MARKETPLACE_INSTALL_COMPLETED_KEY,
} from '@lobechat/const/plugin';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ConnectorToolModel } from '@/database/models/connectorTool';
import { getMCPConnectionErrorType } from '@/libs/mcp/utils';
import { router } from '@/libs/trpc/lambda';
import {
  callConnectorToolById,
  ConnectorToolCallError,
  readConnectorUiResourceById,
  resolveConnectorForRun,
} from '@/server/services/connector/exec';
import {
  getConnectorLocalCallToken,
  getResolvedConnectorLocalCallToken,
} from '@/server/services/connector/localCallToken';
import { loadConnectorPresentation } from '@/server/services/connector/presentation';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { withRequestConnectorCallers } from '../_helpers/connectorCallContext';
import { toConnectorEditDetail } from '../_helpers/connectorEditDetail';
import { connectorProcedure, connectorWriteProcedure } from './procedures';

/**
 * The fields of a row's metadata the client routes a call by: the two install
 * marks (`@lobechat/const/plugin`), and where an HTTP server is reached from —
 * `connectVia` sends one that looks public through the device
 * (`connectorMcpEndpoint`), `boundDeviceId` pins it to a device
 * (`connectorDeviceBinding`).
 */
const ROUTING_METADATA_KEYS = [
  DESKTOP_STDIO_EXECUTION_KEY,
  MARKETPLACE_INSTALL_COMPLETED_KEY,
  'boundDeviceId',
  'connectVia',
];

const pickRoutingMetadata = (metadata: Record<string, unknown> | null | undefined) =>
  Object.fromEntries(
    ROUTING_METADATA_KEYS.filter((key) => metadata?.[key] !== undefined).map((key) => [
      key,
      metadata![key],
    ]),
  );

/**
 * A conversation's use of a connector: calling its tools, reading the views
 * they render with, which row it runs on, and the configuration a desktop
 * needs to run one itself.
 * Every procedure resolves the connector the way the conversation's run does
 * (`resolveConnectorForRun`), so a private connector serves only the
 * conversations that may use it.
 */
export const connectorRunRouter = router({
  /**
   * The connector rows a conversation's run turns into tool sets, each with its
   * tool prefix (`toolIdentifier`): what a client-run chat offers the model and
   * routes calls by. Only the server can tell a private agent's own topic from
   * a group, a channel, a link-shared or another agent's one, and a private
   * agent's own topic also runs its owner's personal rows, which no workspace
   * list on the client holds. Shaped like `connector.list`: no credentials and
   * no client secret; every row is one the caller may run.
   */
  listForRun: connectorProcedure
    .input(z.object({ agentId: z.string().optional(), topicId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      if (input.agentId && !(await ctx.agentModel.existsById(input.agentId))) return [];
      const connectors = await ctx.connectorModel.resolveToolSets({
        agentId: input.agentId,
        topicId: input.topicId,
      });
      const presentation = await loadConnectorPresentation(connectors, ctx);
      // A personal connector's tool rows live in the personal scope
      const wsId = ctx.workspaceId ?? undefined;
      const toolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId, { agentRun: true });
      const tools = await toolModel.queryAllByConnectorIds(connectors.map((c) => c.id));

      return connectors.map(({ credentials: _credentials, oidcConfig, ...connector }) => ({
        ...connector,
        ...presentation.get(connector.id),
        oidcConfig: oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig,
        tools: tools.filter((tool) => tool.userConnectorId === connector.id),
      }));
    }),

  /**
   * The edit-read of the connector a conversation's call runs on, for a desktop
   * that runs a stdio connector itself. The server resolves the row exactly as
   * `callTool` does (`connectorRunScope`, then priority), so the desktop runs
   * the account the server offered the tool from, and a private connector only
   * in a conversation that may use it — never on the client's guess.
   */
  getForRun: connectorWriteProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        identifier: z.string().min(1),
        /** The conversation the call belongs to; see `callTool`. */
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const [connector] = await resolveConnectorForRun(input, ctx);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Creator/owner only, like the edit-read; not gated by the member policy,
      // which must not stop the creator running their own connector.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      // A private agent's run may resolve its owner's personal connector, whose
      // tool rows live in the personal scope.
      const wsId = ctx.workspaceId ?? undefined;
      const toolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId, { agentRun: true });
      return toConnectorEditDetail(connector, await toolModel.queryByConnector(connector.id));
    }),

  /**
   * The OAuth access token a device-routed connector's local desktop call
   * sends (`getConnectorLocalCallToken`).
   *
   * With `run`, the token of the row `getForRun` returned for that call: the
   * row is resolved again for the conversation, so a private agent's own topic
   * reaches its owner's personal connector (which the workspace scope alone
   * cannot read), and a conversation that may not use a private connector never
   * gets its token. Without it (a connector's own settings), a row of the
   * caller's scope by id.
   */
  getLocalCallToken: connectorWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** The account to call as, for a connector holding several; its primary otherwise. */
        linkId: z.string().optional(),
        run: z
          .object({
            agentId: z.string().optional(),
            identifier: z.string().min(1),
            /** The conversation the call belongs to; see `callTool`. */
            topicId: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.run) return getConnectorLocalCallToken(ctx, input.id, input.linkId);

      const [connector] = await resolveConnectorForRun(input.run, ctx);
      // The call runs another row by now (or none): its token is not this one's
      if (connector?.id !== input.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      }
      return getResolvedConnectorLocalCallToken(ctx, connector, input.linkId);
    }),

  /**
   * Which connector row a conversation's call of `identifier` runs on — the
   * row `callTool` resolves. Only the server can tell a private agent's own
   * topic from a group, channel or another agent's one, and the approval a
   * view's call needs and the transport it takes must follow the row that
   * executes, not the client's guess.
   *
   * Besides the id it returns what routing and approval read: the row's
   * transport, its tools, its accounts and its install state (binding, source,
   * status and the routing fields of its metadata), the fields a member's connector list
   * already carries, never credentials or a stdio command, so any member who
   * can call the tool may ask. A private agent's own topic may run its owner's personal
   * connector, which no workspace list on the client holds; the client routes
   * that row on this answer.
   */
  resolveForRun: connectorProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        identifier: z.string().min(1),
        /** The conversation the call belongs to; see `callTool`. */
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const [connector] = await resolveConnectorForRun(input, ctx);
      if (!connector) return null;
      // A personal connector's tool rows live in the personal scope
      const wsId = ctx.workspaceId ?? undefined;
      const toolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId, { agentRun: true });
      // Its accounts, as a member's list shows them: a local call needs to know
      // whether the model must name one (`takeLocalConnectorAccount`)
      const presentation = (await loadConnectorPresentation([connector], ctx)).get(connector.id);
      return {
        agentId: connector.agentId,
        id: connector.id,
        identifier: connector.identifier,
        isEnabled: connector.isEnabled,
        links: presentation?.links ?? [],
        mcpConnectionType: connector.mcpConnectionType,
        mcpServerUrl: connector.mcpServerUrl,
        // Whether an unfinished marketplace install may run, whether a stdio
        // install keeps running on the desktop under a device gateway
        // (`isMarketplaceInstallRunnable`, `keepsDesktopStdioExecution`), and
        // whether an HTTP server runs on a device, and which one
        metadata: pickRoutingMetadata(connector.metadata),
        sourceType: connector.sourceType,
        status: connector.status,
        toolIdentifier: connector.toolIdentifier,
        tools: await toolModel.queryByConnector(connector.id),
      };
    }),

  /**
   * Execute a single connector tool by identifier (classic chat path). Resolves
   * the connector, hard-blocks disabled tools, refreshes the OAuth token if
   * needed, and calls the remote MCP server with the decrypted credentials.
   */
  callTool: connectorWriteProcedure
    .input(
      z.object({
        /** Resolve the identifier for this agent (agent-owned connector first). */
        agentId: z.string().optional(),
        args: z.string().optional(),
        /** An MCP App view's `tools/call`: only tools visible to the app run. */
        fromApp: z.boolean().optional(),
        fromEntrypoint: z.boolean().optional(),
        identifier: z.string().min(1),
        /** The account to call as, for a connector holding several. */
        linkId: z.string().optional(),
        /** With `fromApp`: the server the view came from (`getMcpServerFingerprint`). */
        server: z.string().optional(),
        toolName: z.string().min(1),
        /**
         * The conversation the call runs in, reported as the call's session. A
         * private agent's own topic also lets it use its owner's private
         * connectors; without it the call resolves the workspace's shared
         * connectors only.
         */
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await callConnectorToolById(input, {
          ...withRequestConnectorCallers(ctx),
          // A private agent's call may run on its owner's personal connector,
          // whose tool rows live in the personal scope.
          connectorToolModel: new ConnectorToolModel(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
            { agentRun: true },
          ),
        });
      } catch (err: any) {
        if (err instanceof ConnectorToolCallError) {
          throw new TRPCError({ cause: err, code: err.code, message: err.message });
        }
        if (err instanceof TRPCError && getMCPConnectionErrorType(err.cause)) throw err;
        throw new TRPCError({
          cause: err,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Connector tool call failed: ${err?.message ?? 'unknown error'}`,
        });
      }
    }),

  /**
   * Read the MCP Apps `ui://` resource a connector tool result renders with.
   */
  readUiResource: connectorProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        identifier: z.string().min(1),
        /** The account the tool ran as, for a connector holding several. */
        linkId: z.string().optional(),
        /** The server the result came from (`getMcpServerFingerprint`). */
        server: z.string().min(1),
        /** The conversation the result belongs to; see `callTool`. */
        topicId: z.string().optional(),
        uri: z.string().startsWith('ui://'),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        return await readConnectorUiResourceById(input, ctx);
      } catch (err: any) {
        if (err instanceof ConnectorToolCallError) {
          throw new TRPCError({ cause: err, code: err.code, message: err.message });
        }
        throw err;
      }
    }),
});
