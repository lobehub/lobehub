import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import type { ConnectorCredentials, OIDCConfig } from '@/database/schemas';
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
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  buildAuthorizationUrl,
  discoverConnectorOAuth,
  getConnectorRedirectUri,
  registerDynamicClient,
} from '@/server/services/connector/oauth';
import {
  generateConnectorOAuthState,
  saveConnectorOAuthState,
} from '@/server/services/connector/stateStore';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';

const connectorProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // Credentials (OAuth tokens) are encrypted at rest — give the model a gatekeeper.
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return opts.next({
    ctx: {
      connectorModel: new ConnectorModel(ctx.serverDB, ctx.userId, gateKeeper),
      connectorToolModel: new ConnectorToolModel(ctx.serverDB, ctx.userId),
      pluginModel: new PluginModel(ctx.serverDB, ctx.userId),
    },
  });
});

const oidcConfigSchema = z.object({
  authorizationEndpoint: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  issuer: z.string().optional(),
  redirectUri: z.string().optional(),
  registrationEndpoint: z.string().optional(),
  scheme: z.enum(['pre_registration', 'dcr', 'client_id_metadata_document']),
  scopes: z.array(z.string()).optional(),
  tokenEndpoint: z.string().optional(),
  usePKCE: z.boolean().optional(),
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
  oidcConfig: oidcConfigSchema.optional(),
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
        // Never ship decrypted OAuth tokens or the client secret to the browser.
        const { credentials: _credentials, oidcConfig, ...rest } = c;
        const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
        return { ...rest, oidcConfig: safeOidcConfig, tools };
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
      oidcConfig: input.oidcConfig ?? null,
      status: ConnectorStatus.disconnected,
    });
  }),

  /**
   * Begin the OAuth authorization-code flow for a custom MCP connector.
   *
   * Discovers the authorization server (RFC 9728 → RFC 8414), resolves the
   * client (pre-registration when a client_id was provided, otherwise RFC 7591
   * dynamic registration), persists the resolved OIDC config, and returns the
   * authorize URL for the client to open. The PKCE verifier is stashed in Redis
   * keyed by `state`; the callback route completes the exchange.
   */
  startOAuth: connectorProcedure
    .input(z.object({ id: z.string().uuid(), returnTo: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      if (!connector.mcpServerUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Connector has no MCP server URL' });
      }

      const existing: OIDCConfig = connector.oidcConfig ?? { scheme: 'dcr' };
      const redirectUri = getConnectorRedirectUri();

      // 1. Discover the authorization server backing the MCP resource.
      const { authorizationServerUrl, metadata } = await discoverConnectorOAuth(
        connector.mcpServerUrl,
      );

      // 2. Resolve the OAuth client: pre-registration vs. DCR.
      let clientId = existing.clientId;
      let clientSecret = existing.clientSecret;
      const scheme: OIDCConfig['scheme'] = clientId ? 'pre_registration' : 'dcr';

      if (!clientId) {
        if (!metadata.registration_endpoint) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'This server does not support dynamic registration. Provide an OAuth Client ID in Advanced settings.',
          });
        }
        const reg = await registerDynamicClient({
          authorizationServerUrl,
          metadata,
          redirectUri,
          scopes: existing.scopes,
        });
        clientId = reg.client_id;
        clientSecret = reg.client_secret ?? undefined;
      }

      // 3. Persist the resolved config so the callback + refresh can reuse it.
      const resolvedOidc: OIDCConfig = {
        ...existing,
        authorizationEndpoint: metadata.authorization_endpoint,
        clientId,
        clientSecret,
        issuer: authorizationServerUrl,
        redirectUri,
        registrationEndpoint: metadata.registration_endpoint,
        scheme,
        tokenEndpoint: metadata.token_endpoint,
      };
      await ctx.connectorModel.update(input.id, { oidcConfig: resolvedOidc });

      // 4. Build the authorize URL (with PKCE) and stash the verifier under `state`.
      const state = generateConnectorOAuthState();
      const { authorizationUrl, codeVerifier } = await buildAuthorizationUrl({
        authorizationServerUrl,
        clientInformation: { client_id: clientId, client_secret: clientSecret },
        metadata,
        redirectUri,
        resource: connector.mcpServerUrl,
        scopes: existing.scopes,
        state,
      });

      await saveConnectorOAuthState(state, {
        authorizationServerUrl,
        codeVerifier,
        connectorId: input.id,
        lobeUserId: ctx.userId,
        returnTo: input.returnTo,
      });

      return { authorizationUrl };
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
      let connector = await ctx.connectorModel.findById(input.id);

      if (!connector) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      }

      // Refresh the OAuth access token if it has expired before connecting.
      connector = await ensureFreshConnectorToken(connector, ctx.connectorModel);

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

  /**
   * Reset all tool permissions for a connector back to 'auto' (fully open).
   */
  resetPermissions: connectorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const tools = await ctx.connectorToolModel.queryByConnector(input.id);
      await Promise.all(
        tools.map((t) =>
          ctx.connectorToolModel.updatePermission(t.id, ConnectorToolPermission.auto),
        ),
      );
      return { toolCount: tools.length };
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

  /**
   * Sync tools from a client-provided list (for Lobehub OAuth skills, Klavis, etc.
   * that already have their tool list available on the client side).
   * Idempotent — safe to call whenever the detail panel opens.
   */
  syncToolsFromClient: connectorProcedure
    .input(
      z.object({
        identifier: z.string().min(1),
        name: z.string().min(1),
        sourceType: z.enum([
          ConnectorSourceType.builtin,
          ConnectorSourceType.custom,
          ConnectorSourceType.marketplace,
        ]),
        tools: z.array(
          z.object({
            description: z.string().optional(),
            inputSchema: z.record(z.unknown()).optional(),
            toolName: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const connectorId = await upsertConnectorEntry(ctx.connectorModel, {
        identifier: input.identifier,
        name: input.name,
        sourceType: input.sourceType,
      });

      const syncInputs = input.tools.map((t) => ({
        crudType: inferCrudType(t.toolName),
        description: t.description,
        inputSchema: t.inputSchema,
        toolName: t.toolName,
      }));

      await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
      return { connectorId, toolCount: syncInputs.length };
    }),

  /**
   * Bootstrap a connector entry for a builtin tool (lobe-creds, lobe-local-system, etc.)
   * by reading its manifest from @lobechat/builtin-tools.
   * Idempotent — safe to call on every open of the detail panel.
   */
  syncBuiltinTool: connectorProcedure
    .input(z.object({ identifier: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { builtinTools } = await import('@lobechat/builtin-tools');
      const tool = builtinTools.find((t) => t.identifier === input.identifier);

      if (!tool) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Builtin tool '${input.identifier}' not found`,
        });
      }

      const connectorId = await upsertConnectorEntry(ctx.connectorModel, {
        avatar: tool.manifest.meta?.avatar,
        description: tool.manifest.meta?.description,
        identifier: input.identifier,
        name: tool.manifest.meta?.title || input.identifier,
        sourceType: ConnectorSourceType.builtin,
      });

      const syncInputs = tool.manifest.api.map((api) => ({
        crudType: inferCrudType(api.name),
        defaultPermission: resolveDefaultPermission(api.humanIntervention),
        description: api.description,
        inputSchema: api.parameters as Record<string, unknown>,
        toolName: api.name,
      }));

      await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
      return { connectorId, toolCount: syncInputs.length };
    }),

  /**
   * Bootstrap a connector entry for an installed marketplace plugin.
   * Reads tool list from user_installed_plugins.manifest.api.
   * Idempotent — safe to call on every open of the detail panel.
   */
  syncPluginTools: connectorProcedure
    .input(z.object({ identifier: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const plugin = await ctx.pluginModel.findById(input.identifier);

      if (!plugin || !plugin.manifest) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin '${input.identifier}' not found or has no manifest`,
        });
      }

      const connectorId = await upsertConnectorEntry(ctx.connectorModel, {
        avatar: plugin.manifest.meta?.avatar,
        description: plugin.manifest.meta?.description,
        identifier: input.identifier,
        name: plugin.manifest.meta?.title || input.identifier,
        sourceType: ConnectorSourceType.marketplace,
      });

      const apiList = plugin.manifest.api ?? [];
      const syncInputs = apiList.map((api: any) => ({
        crudType: inferCrudType(api.name),
        defaultPermission: resolveDefaultPermission(api.humanIntervention),
        description: api.description,
        inputSchema: api.parameters as Record<string, unknown>,
        toolName: api.name,
      }));

      await ctx.connectorToolModel.upsertMany(connectorId, syncInputs);
      return { connectorId, toolCount: syncInputs.length };
    }),
});

// ── Private helpers ───────────────────────────────────────────────────────────

/** Create connector entry if not exists (or update metadata), return connectorId */
async function upsertConnectorEntry(
  connectorModel: ConnectorModel,
  params: {
    avatar?: string;
    description?: string;
    identifier: string;
    name: string;
    sourceType: string;
  },
): Promise<string> {
  const metadata: Record<string, unknown> = {};
  if (params.description) metadata.description = params.description;
  if (params.avatar) metadata.avatar = params.avatar;

  const existing = await connectorModel.queryByIdentifiers([params.identifier]);
  if (existing.length > 0) {
    // Update metadata with latest description/avatar from manifest
    await connectorModel.update(existing[0].id, { metadata });
    return existing[0].id;
  }

  const created = await connectorModel.create({
    identifier: params.identifier,
    isEnabled: true,
    metadata,
    name: params.name,
    sourceType: params.sourceType as any,
    status: ConnectorStatus.connected,
  });
  return created.id;
}

/** Map builtin manifest humanIntervention → default ConnectorToolPermission */
function resolveDefaultPermission(humanIntervention: unknown): ConnectorToolPermission {
  if (humanIntervention === 'required' || humanIntervention === 'always') {
    return ConnectorToolPermission.needs_approval;
  }
  return ConnectorToolPermission.auto;
}

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
