import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import type { OIDCConfig } from '@/database/schemas';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
  ConnectorToolPermission,
} from '@/database/schemas';
import { inferCrudType } from '@/libs/mcp/utils';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { callConnectorToolById, ConnectorToolCallError } from '@/server/services/connector/exec';
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
import { syncConnectorToolsById } from '@/server/services/connector/sync';

const connectorProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // Credentials (OAuth tokens) are encrypted at rest — give the model a gatekeeper.
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      connectorModel: new ConnectorModel(ctx.serverDB, ctx.userId, wsId, gateKeeper),
      connectorToolModel: new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId),
      pluginModel: new PluginModel(ctx.serverDB, ctx.userId, wsId),
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

/**
 * Non-OAuth credentials the client may set directly when creating/updating a
 * connector. OAuth2 tokens are intentionally excluded — those are written only
 * by the OAuth callback after a successful authorization exchange.
 */
const connectorCredentialsInputSchema = z.discriminatedUnion('type', [
  z.object({ token: z.string().min(1), type: z.literal('bearer') }),
  z.object({ apiKey: z.string().min(1), type: z.literal('apikey') }),
  z.object({ headers: z.record(z.string()), type: z.literal('header') }),
]);

const createConnectorSchema = z.object({
  credentials: connectorCredentialsInputSchema.optional(),
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

  /**
   * Return the connector record with decrypted user-set credentials so the
   * edit form can pre-fill accurately. Only the connector owner can call this
   * (enforced by connectorProcedure ownership check).
   *
   * Machine-managed secrets are intentionally excluded:
   * - OAuth access/refresh tokens (type 'oauth2') → stripped, returned as null
   * - oidcConfig.clientSecret (DCR-registered secret)  → stripped
   * User-set credentials (bearer token, custom headers) are returned as-is so
   * the edit form can display them.
   */
  getForEdit: connectorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });

      const { oidcConfig, credentials, ...rest } = connector;
      const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
      // OAuth tokens are machine-managed — don't return them; the UI only needs
      // to know an OAuth flow is configured (reflected via oidcConfig presence).
      const safeCredentials = credentials?.type === 'oauth2' ? null : credentials;

      return { ...rest, credentials: safeCredentials, oidcConfig: safeOidcConfig };
    }),

  /**
   * The exact redirect URI the server will send to the OAuth/DCR endpoints.
   * The Add modal must display THIS value (not a client-derived origin) so the
   * URI the user registers matches the one used at authorize time.
   */
  getRedirectUri: wsCompatProcedure.query(() => ({ redirectUri: getConnectorRedirectUri() })),

  // ── Mutations ─────────────────────────────────────────────────────────────

  create: connectorProcedure.input(createConnectorSchema).mutation(async ({ input, ctx }) => {
    const fields = {
      // The model expects the decrypted JSON string and encrypts it at rest.
      credentials: input.credentials ? JSON.stringify(input.credentials) : null,
      mcpConnectionType: input.mcpConnectionType ?? null,
      mcpServerUrl: input.mcpServerUrl ?? null,
      mcpStdioConfig: input.mcpStdioConfig ?? null,
      metadata: input.metadata ?? null,
      name: input.name,
      oidcConfig: input.oidcConfig ?? null,
    };

    // Idempotent on (user_id, identifier): re-adding or re-authorizing the same
    // connector updates the existing row instead of violating the unique index.
    // Status resets to `disconnected` — the OAuth callback / tool sync promotes
    // it back to `connected` on success.
    //
    // `sourceType` is honored on update so the legacy customPlugin → connector
    // migration can promote a half-baked `marketplace` row left behind by the
    // older `syncPluginTools` code path into a proper `custom` row. Without
    // this the connector would land but never appear in custom-connector
    // listings (selector filters on sourceType === 'custom'). Safe because the
    // other callers (`AddConnectorModal`, marketplace bootstrap) always pass
    // the same sourceType they originally created the row with.
    const [existing] = await ctx.connectorModel.queryByIdentifiers([input.identifier]);
    if (existing) {
      await ctx.connectorModel.update(existing.id, {
        ...fields,
        isEnabled: input.isEnabled ?? true,
        sourceType: input.sourceType,
        status: ConnectorStatus.disconnected,
      });
      return { id: existing.id };
    }

    return ctx.connectorModel.create({
      ...fields,
      identifier: input.identifier,
      isEnabled: input.isEnabled ?? true,
      sourceType: input.sourceType,
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

      // Default to the scopes advertised by the server when the user did not
      // specify any — many MCP authorization servers reject (or issue a useless
      // token for) a scope-less request.
      const scopes =
        existing.scopes && existing.scopes.length > 0 ? existing.scopes : metadata.scopes_supported;

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
          scopes,
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
        scopes,
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
        scopes,
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
        patch: createConnectorSchema
          .partial()
          .omit({ identifier: true, sourceType: true })
          // Allow `null` here so an edit can clear credentials (switch to no-auth).
          .extend({ credentials: connectorCredentialsInputSchema.nullish() }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { credentials, ...patch } = input.patch;
      await ctx.connectorModel.update(input.id, {
        ...patch,
        // undefined → leave untouched; null → clear; object → encrypt the JSON string.
        // When credentials are cleared, also drop the cached expiry timestamp so
        // token-refresh logic doesn't act on a stale value for the new server.
        ...(credentials === undefined
          ? {}
          : {
              credentials: credentials ? JSON.stringify(credentials) : null,
              ...(credentials === null ? { tokenExpiresAt: null } : {}),
            }),
      } as any);
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
  callTool: connectorProcedure
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
   * Sync tools from a client-provided list (for Lobehub OAuth skills, Composio, etc.
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
   *
   * Skips `type='customPlugin'` rows that carry an MCP endpoint: those are
   * legacy custom MCPs and now go through the frontend migration flow
   * (CustomConnectorModal in `legacyPlugin` mode), which produces a fully
   * populated `user_connectors` row (with `mcpServerUrl` / `credentials`).
   * Letting this procedure build a half-baked marketplace row for them would
   * be filtered out by the runtime (`buildConnectorManifests` requires a
   * transport endpoint) and would also collide on the unique `(user_id,
   * identifier)` index when the migration later tries to upsert.
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

      if (plugin.type === 'customPlugin' && plugin.customParams?.mcp) {
        // Hand off to the frontend migration flow. Returning null tells the
        // caller "no connector row produced"; the SkillDetail panel falls back
        // to the legacy plugin display, and the "Configure" button surfaces
        // CustomConnectorModal in migration mode.
        return { connectorId: null, toolCount: 0 };
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
