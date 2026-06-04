import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { ConnectorCredentials } from '@/database/schemas';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
  ConnectorToolPermission,
} from '@/database/schemas';
import type { AuthConfig } from '@/libs/mcp';
import { inferCrudType } from '@/libs/mcp/utils';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { mcpService } from '@/server/services/mcp';

const connectorProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      connectorModel: new ConnectorModel(ctx.serverDB, ctx.userId),
      connectorToolModel: new ConnectorToolModel(ctx.serverDB, ctx.userId),
    },
  });
});

const createConnectorSchema = z.object({
  identifier: z.string().min(1).max(255),
  isEnabled: z.boolean().optional().default(true),
  mcpConnectionType: z
    .enum([
      ConnectorMcpConnectionType.http,
      ConnectorMcpConnectionType.stdio,
      ConnectorMcpConnectionType.cloud,
    ])
    .optional(),
  mcpServerUrl: z.string().url().optional(),
  mcpStdioConfig: z
    .object({
      args: z.array(z.string()).optional(),
      command: z.string(),
      env: z.record(z.string()).optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  name: z.string().min(1).max(255),
  oidcConfig: z.record(z.unknown()).optional(),
  sourceType: z.enum([
    ConnectorSourceType.builtin,
    ConnectorSourceType.custom,
    ConnectorSourceType.marketplace,
  ]),
});

export const connectorRouter = router({
  // ── Queries ──────────────────────────────────────────────────────────────

  list: connectorProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.connectorModel.query();

    const toolsByConnector = await Promise.all(
      connectors.map(async (c) => {
        const tools = await ctx.connectorToolModel.queryByConnector(c.id);
        return { ...c, tools };
      }),
    );

    return toolsByConnector;
  }),

  // ── Mutations ─────────────────────────────────────────────────────────────

  create: connectorProcedure.input(createConnectorSchema).mutation(async ({ input, ctx }) => {
    return ctx.connectorModel.create({
      ...input,
      mcpConnectionType: input.mcpConnectionType ?? null,
      mcpServerUrl: input.mcpServerUrl ?? null,
      mcpStdioConfig: input.mcpStdioConfig ?? null,
      metadata: input.metadata ?? null,
      oidcConfig: (input.oidcConfig as any) ?? null,
      status: ConnectorStatus.disconnected,
    });
  }),

  update: connectorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        patch: createConnectorSchema.partial().omit({ identifier: true, sourceType: true }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.connectorModel.update(input.id, input.patch as any);
    }),

  delete: connectorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.connectorModel.delete(input.id);
    }),

  /**
   * Fetch the tool list from the remote MCP server and sync it into
   * `user_connector_tools`. Manifest-derived fields are overwritten;
   * user permission settings are preserved.
   */
  syncTools: connectorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);

      if (!connector) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      }

      if (
        !connector.mcpServerUrl &&
        connector.mcpConnectionType !== ConnectorMcpConnectionType.stdio
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Connector has no MCP server URL configured',
        });
      }

      // Build MCPClientParams from stored connector config
      let mcpParams: Parameters<typeof mcpService.listRawTools>[0];

      if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) {
        if (!connector.mcpStdioConfig) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing stdio config' });
        }
        mcpParams = {
          args: connector.mcpStdioConfig.args ?? [],
          command: connector.mcpStdioConfig.command,
          env: connector.mcpStdioConfig.env,
          name: connector.name,
          type: 'stdio',
        };
      } else {
        // http or cloud — both use URL-based connection
        const auth = buildAuthFromCredentials(connector.credentials);
        mcpParams = {
          auth,
          name: connector.name,
          type: 'http',
          url: connector.mcpServerUrl!,
        };
      }

      let rawTools: Awaited<ReturnType<typeof mcpService.listRawTools>>;
      try {
        rawTools = await mcpService.listRawTools(mcpParams);
      } catch (err: any) {
        await ctx.connectorModel.updateStatus(input.id, ConnectorStatus.error);
        throw new TRPCError({
          cause: err,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch tools from MCP server: ${err?.message ?? 'unknown error'}`,
        });
      }

      const syncInputs = rawTools.map((t) => ({
        crudType: inferCrudType(t.name),
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        toolName: t.name,
      }));

      await ctx.connectorToolModel.upsertMany(input.id, syncInputs);
      await ctx.connectorModel.updateStatus(input.id, ConnectorStatus.connected);

      return { toolCount: syncInputs.length };
    }),

  updateToolPermission: connectorProcedure
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
      await ctx.connectorToolModel.updatePermission(input.toolId, input.permission);
    }),
});

// ── Private helpers ───────────────────────────────────────────────────────────

function buildAuthFromCredentials(
  credentials: ConnectorCredentials | null,
): AuthConfig | undefined {
  if (!credentials) return undefined;

  switch (credentials.type) {
    case 'oauth2': {
      return {
        accessToken: credentials.accessToken,
        clientId: undefined,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        tokenExpiresAt: credentials.expiresAt,
        type: 'oauth2',
      };
    }
    case 'bearer': {
      return { token: credentials.token, type: 'bearer' };
    }
    default: {
      return undefined;
    }
  }
}
