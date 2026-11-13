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

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { toConnectorEditDetail } from '../_helpers/connectorEditDetail';
import { connectorProcedure, connectorWriteProcedure } from './procedures';

/**
 * A conversation's use of a connector: calling its tools, reading the views
 * they render with, and the configuration a desktop needs to run one itself.
 * Every procedure resolves the connector the way the conversation's run does
 * (`resolveConnectorForRun`), so a private connector serves only the
 * conversations that may use it.
 */
export const connectorRunRouter = router({
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
        identifier: z.string().min(1),
        /** With `fromApp`: the server the view came from (`getMcpServerFingerprint`). */
        server: z.string().optional(),
        toolName: z.string().min(1),
        /**
         * The conversation the call belongs to. A private agent's own topic
         * lets it use its owner's private connectors; without it the call
         * resolves the workspace's shared connectors only.
         */
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await callConnectorToolById(input, {
          ...ctx,
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
