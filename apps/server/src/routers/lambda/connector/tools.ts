import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ConnectorStatus, ConnectorToolPermission } from '@/database/schemas';
import { inferCrudType } from '@/libs/mcp/utils';
import { callConnectorToolById, ConnectorToolCallError } from '@/server/services/connector/exec';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { connectorWriteProcedure } from './procedures';

export const toolProcedures = {
  /**
   * Fetch the tool list from the remote MCP server and sync it into
   * `user_connector_tools`. Manifest-derived fields are overwritten;
   * user permission settings are preserved.
   */
  syncTools: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Syncing rewrites the connector's tool rows and refreshes OAuth tokens —
      // an edit-class operation, so it gets the same creator/owner gate as
      // update/delete/reset.
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');
      try {
        return await syncConnectorToolsById(input.id, ctx);
      } catch (err: any) {
        throw new TRPCError({
          cause: err,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch tools from MCP server: ${err?.message ?? 'unknown error'}`,
        });
      }
    }),
  /**
   * Execute a single connector tool by identifier (classic chat path). Resolves
   * the connector, hard-blocks disabled tools, refreshes the OAuth token if
   * needed, and calls the remote MCP server with the decrypted credentials.
   */
  callTool: connectorWriteProcedure
    .input(
      z.object({
        args: z.string().optional(),
        identifier: z.string().min(1),
        toolName: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await callConnectorToolById(input, ctx);
      } catch (err: any) {
        if (err instanceof ConnectorToolCallError) {
          throw new TRPCError({ cause: err, code: err.code, message: err.message });
        }
        throw new TRPCError({
          cause: err,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Connector tool call failed: ${err?.message ?? 'unknown error'}`,
        });
      }
    }),
  /**
   * Reset all tool permissions for a connector back to 'auto' (fully open).
   */
  resetPermissions: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Permission gates decide what auto-runs for the whole workspace.
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');

      const tools = await ctx.connectorToolModel.queryByConnector(input.id);
      await Promise.all(
        tools.map((t) =>
          ctx.connectorToolModel.updatePermission(t.id, ConnectorToolPermission.auto),
        ),
      );
      return { toolCount: tools.length };
    }),
  updateToolPermission: connectorWriteProcedure
    .input(
      z.object({
        permission: z.enum([
          ConnectorToolPermission.auto,
          ConnectorToolPermission.needs_approval,
          ConnectorToolPermission.disabled,
        ]),
        toolId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tool = await ctx.connectorToolModel.findById(input.toolId);
      if (!tool) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector tool not found' });
      const owner = await ctx.connectorModel.findById(tool.userConnectorId);
      assertWorkspaceRowManageable(ctx, owner?.userId, 'connector');

      await ctx.connectorToolModel.updatePermission(input.toolId, input.permission);
    }),
  /**
   * Sync a client-fetched tool list into an EXISTING connector row. This is the
   * install/refresh path for connectors the cloud server cannot reach itself:
   * stdio MCP (the binary lives on the user's machine) and local/private-network
   * HTTP endpoints. The desktop client connects locally, lists the tools, and
   * reports them here — the server-side `syncTools` counterpart would otherwise
   * try (and fail) to connect from the cloud (#16533).
   *
   * Also promotes the connector to `connected`, mirroring what
   * `syncConnectorToolsById` does after a successful server-side sync.
   */
  syncToolsFromClientById: connectorWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        tools: z.array(
          z.object({
            description: z.string().optional(),
            inputSchema: z.record(z.string(), z.unknown()).optional(),
            toolName: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Same edit-class gate as `syncTools` — rewrites the connector's tool rows.
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');

      const syncInputs = input.tools.map((t) => ({
        crudType: inferCrudType(t.toolName),
        description: t.description,
        inputSchema: t.inputSchema,
        toolName: t.toolName,
      }));

      await ctx.connectorToolModel.upsertMany(input.id, syncInputs);
      await ctx.connectorModel.updateStatus(input.id, ConnectorStatus.connected);
      return { toolCount: syncInputs.length };
    }),
};
