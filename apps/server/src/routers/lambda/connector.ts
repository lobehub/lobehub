import { upsertPluginMode } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
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
import type { LobeChatDatabase } from '@/database/type';
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
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import {
  resolveConnectorAuthorizerId,
  resolveUserDisplayMap,
  withTrustedLinkedByUserId,
} from '@/server/utils/connectorAttribution';

import {
  assertWorkspaceRowManageable,
  isWorkspaceNonOwner,
} from './_helpers/assertWorkspaceRowManageable';

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

// Writes: workspace mode requires at least the member role, gating viewers
// out (read-only role) while personal mode passes through unrestricted.
const connectorWriteProcedure = connectorProcedure.use(requireWorkspaceRoleWhenScoped('member'));

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
  z.object({ headers: z.record(z.string(), z.string()), type: z.literal('header') }),
]);

const createConnectorSchema = z.object({
  /**
   * Bind this connector to a specific agent (Agent > Workspace/Personal). When
   * set, the row is agent-scoped: it only resolves for that agent's runs and
   * holds the agent's own credentials (service-account pattern). The caller must
   * be able to edit the agent. Omit for a normal personal/workspace connector.
   */
  agentId: z.string().optional(),
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
      env: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

    // Attribution — resolve the member who authorized each connector (workspace
    // dimension), so the profile can tag "authorized by X". The ids come from
    // scope-checked rows the caller already sees.
    const authorMap = await resolveUserDisplayMap(
      ctx.serverDB,
      connectors.map((c) => resolveConnectorAuthorizerId(c)),
    );

    const toolsByConnector = await Promise.all(
      connectors.map(async (c) => {
        const tools = await ctx.connectorToolModel.queryByConnector(c.id);
        // Never ship decrypted OAuth tokens or the client secret to the browser.
        const { credentials: _credentials, oidcConfig, ...rest } = c;
        const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
        const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
        return {
          ...rest,
          authorizedByAvatar: author?.avatar ?? null,
          authorizedByName: author?.name ?? null,
          oidcConfig: safeOidcConfig,
          tools,
        };
      }),
    );

    return toolsByConnector;
  }),

  /**
   * List the connectors bound to a specific agent (agent-scoped rows only). The
   * agent-settings UI uses this to show + manage the agent's own connectors,
   * which the base `list` deliberately excludes.
   */
  listByAgent: connectorProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const connectors = await ctx.connectorModel.queryByAgent(input.agentId);

      // Attribution — the member who authorized each agent-scoped connector, so
      // a teammate viewing the agent sees "authorized by X" on each chip.
      const authorMap = await resolveUserDisplayMap(
        ctx.serverDB,
        connectors.map((c) => resolveConnectorAuthorizerId(c)),
      );

      return Promise.all(
        connectors.map(async (c) => {
          const tools = await ctx.connectorToolModel.queryByConnector(c.id);
          const { credentials: _credentials, oidcConfig, ...rest } = c;
          const safeOidcConfig = oidcConfig
            ? { ...oidcConfig, clientSecret: undefined }
            : oidcConfig;
          const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
          return {
            ...rest,
            authorizedByAvatar: author?.avatar ?? null,
            authorizedByName: author?.name ?? null,
            oidcConfig: safeOidcConfig,
            tools,
          };
        }),
      );
    }),

  /**
   * List every agent-OWNED connector in the current scope (all agents at once),
   * so the unified connector-settings page can show "which connector belongs to
   * which agent" without querying one agent at a time. Each row keeps its
   * `agentId` and is enriched with the owning agent's `agentTitle`/`agentAvatar`
   * for attribution badges. Scope-correct via `ConnectorModel.ownership()` (and
   * `AgentModel.ownership()` for the titles) — a workspace context only returns
   * that workspace's agent connectors (LOBE-11681 / LOBE-11682).
   */
  listAgentBound: connectorProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.connectorModel.queryAllAgentScoped();

    // Resolve owning-agent display info in one scoped query (workspace-aware),
    // instead of loading each agent's config client-side from a page that isn't
    // in any agent's context.
    const agentIds = [
      ...new Set(connectors.map((c) => c.agentId).filter((id): id is string => !!id)),
    ];
    const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    // `getAgentAvatarsByIds` applies `AgentModel.ownership()` (visibility-aware):
    // in a workspace it returns only agents visible to the caller — public ones
    // plus their own private agents. A `user_connectors` row is scoped only by
    // `workspace_id`, so on its own it would surface connectors owned by another
    // member's PRIVATE agent. Gate on the visible-agent set so private-agent
    // connector inventory never leaks across members (LOBE-11681).
    const agentMetas = agentIds.length > 0 ? await agentModel.getAgentAvatarsByIds(agentIds) : [];
    const agentMetaById = new Map(agentMetas.map((m) => [m.id, m]));

    return Promise.all(
      connectors
        .filter((c) => !!c.agentId && agentMetaById.has(c.agentId))
        .map(async (c) => {
          const tools = await ctx.connectorToolModel.queryByConnector(c.id);
          const { credentials: _credentials, oidcConfig, ...rest } = c;
          const safeOidcConfig = oidcConfig
            ? { ...oidcConfig, clientSecret: undefined }
            : oidcConfig;
          const meta = agentMetaById.get(c.agentId!);
          return {
            ...rest,
            agentAvatar: meta?.avatar ?? null,
            agentTitle: meta?.title ?? null,
            oidcConfig: safeOidcConfig,
            tools,
          };
        }),
    );
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
  // Member-gated even though it's a query: it returns decrypted credentials
  // for edit prefill, so a creator later downgraded to viewer must not reach it.
  getForEdit: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Edit-read returns decrypted credentials — same creator/owner gate as
      // the mutations that this edit view feeds.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

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

  create: connectorWriteProcedure.input(createConnectorSchema).mutation(async ({ input, ctx }) => {
    const { agentId } = input;

    // Agent-scoped connector: the caller must be able to edit the target agent
    // before a credential is bound to it — otherwise a user could attach their
    // account to someone else's agent. Scoped to the caller's user/workspace.
    if (agentId) {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const canEdit = await agentModel.existsOwnedById(agentId);
      if (!canEdit) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }
    }

    const fields = {
      // The model expects the decrypted JSON string and encrypts it at rest.
      credentials: input.credentials ? JSON.stringify(input.credentials) : null,
      mcpConnectionType: input.mcpConnectionType ?? null,
      mcpServerUrl: input.mcpServerUrl ?? null,
      mcpStdioConfig: input.mcpStdioConfig ?? null,
      // Drop any client-supplied `composio.linkedByUserId` — it is server-owned
      // (written by the OAuth connect path), and trusting it here would let a
      // member spoof connector attribution. No existing row on create → the
      // field is simply removed.
      metadata: withTrustedLinkedByUserId(input.metadata, undefined) ?? null,
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
    // Idempotent within the EXACT scope (this agent's row, or the base row when
    // no agentId). The exact-scope lookup is critical: creating an agent
    // connector must not update the personal/workspace row of the same
    // identifier, and re-adding the same agent connector updates its own row —
    // enforcing "one connector per identifier per agent" at the app layer (the
    // DB indexes are non-unique so multiple same-identifier rows can coexist
    // across scopes).
    const existing = await ctx.connectorModel.findScopedByIdentifier(input.identifier, agentId);
    if (existing) {
      // The upsert path rewrites another creator's config/credentials — only
      // the creator (or a workspace owner) may re-add over an existing row.
      assertWorkspaceRowManageable(ctx, existing.userId, 'connector');
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
      agentId: agentId ?? null,
      identifier: input.identifier,
      isEnabled: input.isEnabled ?? true,
      sourceType: input.sourceType,
      status: ConnectorStatus.disconnected,
    });
  }),

  /**
   * Bind an existing connector to an agent (transfer it into the agent scope).
   * The connector then resolves only for that agent's runs and shadows the
   * user's base connector of the same identifier (Agent > Workspace/Personal).
   *
   * Guards: the caller must be able to edit the agent; the agent must not
   * already have a connector for this identifier (one per identifier per agent).
   */
  bindAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Rebinding routes the connector's credentials to the agent — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const existingAgentRow = await ctx.connectorModel.findScopedByIdentifier(
        connector.identifier,
        input.agentId,
      );
      if (existingAgentRow && existingAgentRow.id !== connector.id) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${connector.identifier}" connector`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, { agentId: input.agentId });
      return { id: input.connectorId };
    }),

  /**
   * Unbind a connector from its agent, returning it to the personal/workspace
   * scope. Rejected when a base connector of the same identifier already exists,
   * to keep the base scope single-per-identifier — the caller should delete the
   * agent connector instead of demoting it into a collision.
   */
  unbindAgent: connectorWriteProcedure
    .input(z.object({ connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      if (!connector.agentId) return { id: input.connectorId }; // already base — no-op

      const existingBase = await ctx.connectorModel.findScopedByIdentifier(connector.identifier);
      if (existingBase) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A personal "${connector.identifier}" connector already exists; delete the agent connector instead`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, { agentId: null });
      return { id: input.connectorId };
    }),

  /**
   * "Copy user tool": clone a user connector into an independent agent-owned
   * row (own credentials, separately editable). Server-side because the
   * credentials ciphertext never reaches the client (see ConnectorModel).
   */
  copyToAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const source = await ctx.connectorModel.findById(input.connectorId);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Cloning duplicates the source's encrypted credentials into a row the
      // agent owner controls — creator/owner only.
      assertWorkspaceRowManageable(ctx, source.userId, 'connector');

      const existing = await ctx.connectorModel.findScopedByIdentifier(
        source.identifier,
        input.agentId,
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${source.identifier}" connector`,
        });
      }

      const created = await ctx.connectorModel.copyToAgent(input.connectorId, input.agentId);
      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      return { id: created.id };
    }),

  /**
   * "Mount user tool" (Linked): reference-lock a user connector onto this agent.
   * The row stays user-owned (keeps syncing with the user's edits) but resolves
   * for this agent and is locked so no other agent can mount the same one.
   */
  mountToAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Mounting routes the source's credentials to the agent and locks the
      // row (metadata.mountedByAgentId) — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      if (connector.agentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a user connector can be mounted (this one is already agent-owned)',
        });
      }

      const lockedBy = connector.metadata?.mountedByAgentId;
      if (lockedBy && lockedBy !== input.agentId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Connector is already mounted by another agent',
        });
      }

      const existing = await ctx.connectorModel.findScopedByIdentifier(
        connector.identifier,
        input.agentId,
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${connector.identifier}" connector`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, {
        metadata: { ...connector.metadata, mountedByAgentId: input.agentId },
      });
      return { id: input.connectorId };
    }),

  /** Unmount a connector from its agent (clears the reference lock). */
  unmountFromAgent: connectorWriteProcedure
    .input(z.object({ connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Clearing the mount lock mutates the source row — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const { mountedByAgentId: _drop, ...restMeta } = connector.metadata ?? {};
      await ctx.connectorModel.update(input.connectorId, { metadata: restMeta });
      return { id: input.connectorId };
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
  startOAuth: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid(), returnTo: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Re-authorizing overwrites the stored OAuth credentials.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
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

  update: connectorWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        patch: createConnectorSchema
          .partial()
          // `agentId` is intentionally omitted: moving a connector in/out of
          // agent scope must go through bindAgent/unbindAgent (agent edit-rights
          // + uniqueness guards), not the generic update patch.
          .omit({ agentId: true, identifier: true, sourceType: true })
          // Allow `null` here so an edit can clear credentials (switch to no-auth).
          .extend({ credentials: connectorCredentialsInputSchema.nullish() }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');

      const { credentials, ...patch } = input.patch;
      // Preserve the server-owned `composio.linkedByUserId` from the stored row
      // and ignore whatever the client sent, so an edit can never spoof (or
      // silently clear) the connector's authorizer. Untouched when the patch
      // omits metadata.
      const metadata = withTrustedLinkedByUserId(patch.metadata, target.metadata);
      await ctx.connectorModel.update(input.id, {
        ...patch,
        ...(patch.metadata === undefined ? {} : { metadata }),
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

  delete: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!target) return;
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');
      await ctx.connectorModel.delete(input.id);

      // Agent-owned connector: also unpin its tool from the owning agent's
      // `plugins`, so deleting it here matches the agent-profile delete (row +
      // pin) and never leaves a dangling pin. Done server-side because the
      // unified settings page has no safe access to an arbitrary agent's config
      // (mirrors the profile page's client-side unpin, `upsertPluginMode(...,
      // 'auto')`). Idempotent: re-running on an already-unpinned agent is a no-op.
      if (target.agentId) {
        const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const config = await agentModel.getAgentConfigById(target.agentId);
        if (config) {
          await agentModel.update(target.agentId, {
            plugins: upsertPluginMode(
              config.plugins ?? undefined,
              target.identifier,
              'auto',
            ) as any,
          });
        }
      }
    }),

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
   * Sync tools from a client-provided list (for Lobehub OAuth skills, Composio, etc.
   * that already have their tool list available on the client side).
   * Idempotent — safe to call whenever the detail panel opens.
   */
  // Bootstrap syncs run on detail-panel open for every role; viewer
  // restrictions are handled inside upsertConnectorEntry (read-only for
  // existing rows, no creation).
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
            inputSchema: z.record(z.string(), z.unknown()).optional(),
            toolName: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { connectorId, writable } = await upsertConnectorEntry(ctx, {
        identifier: input.identifier,
        name: input.name,
        sourceType: input.sourceType,
      });
      if (!writable) return { connectorId, toolCount: 0 };

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

      const { connectorId, writable } = await upsertConnectorEntry(ctx, {
        avatar: tool.manifest.meta?.avatar,
        description: tool.manifest.meta?.description,
        identifier: input.identifier,
        name: tool.manifest.meta?.title || input.identifier,
        sourceType: ConnectorSourceType.builtin,
      });
      if (!writable) return { connectorId, toolCount: 0 };

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

      if (!plugin) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin '${input.identifier}' not found`,
        });
      }

      // The customPlugin migration guard MUST run before the manifest check.
      // The users hit by #15674 are the ones whose legacy custom MCP never
      // successfully reported a `tools/list` after the v2.2.3 break, so their
      // `user_installed_plugins.manifest` is NULL / empty. If we threw
      // NOT_FOUND here the SkillDetail fallback would never render and the
      // migration modal would never surface — exactly the users we are
      // trying to rescue. Hand off to the frontend migration flow first;
      // returning null tells the caller "no connector row produced" and the
      // "Configure" button opens CustomConnectorModal in migration mode.
      if (plugin.type === 'customPlugin' && plugin.customParams?.mcp) {
        return { connectorId: null, toolCount: 0 };
      }

      if (!plugin.manifest) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Plugin '${input.identifier}' has no manifest`,
        });
      }

      const { connectorId, writable } = await upsertConnectorEntry(ctx, {
        avatar: plugin.manifest.meta?.avatar,
        description: plugin.manifest.meta?.description,
        identifier: input.identifier,
        name: plugin.manifest.meta?.title || input.identifier,
        sourceType: ConnectorSourceType.marketplace,
      });
      if (!writable) return { connectorId, toolCount: 0 };

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

/**
 * Create connector entry if not exists (or update metadata), return connectorId.
 *
 * These bootstrap syncs run whenever any member opens a shared skill's detail
 * panel, so an existing row created by someone else must not be rewritten by a
 * non-owner caller — the row is returned read-only (`writable: false`) and the
 * caller skips the tool upsert instead of throwing, keeping browsing intact.
 */
async function upsertConnectorEntry(
  ctx: {
    connectorModel: ConnectorModel;
    serverDB: LobeChatDatabase;
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  params: {
    avatar?: string;
    description?: string;
    identifier: string;
    name: string;
    sourceType: string;
  },
): Promise<{ connectorId: string; writable: boolean }> {
  const metadata: Record<string, unknown> = {};
  if (params.description) metadata.description = params.description;
  if (params.avatar) metadata.avatar = params.avatar;

  // Viewers keep browse access: they resolve existing rows read-only below,
  // but must never create or rewrite connector state. These bootstrap
  // endpoints run without the RBAC middleware, so ctx.workspaceRole may be
  // absent — a missing role must NOT be treated as writable; fall back to an
  // explicit member-level permission check (viewers lack agent:update).
  const canWrite = !ctx.workspaceId
    ? true
    : ctx.workspaceRole
      ? ctx.workspaceRole !== 'viewer'
      : await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

  const existing = await ctx.connectorModel.queryByIdentifiers([params.identifier]);
  if (existing.length > 0) {
    const row = existing[0];
    const writable = canWrite && (!isWorkspaceNonOwner(ctx) || row.userId === ctx.userId);
    if (writable) {
      // Update metadata with latest description/avatar from manifest
      await ctx.connectorModel.update(row.id, { metadata });
    }
    return { connectorId: row.id, writable };
  }

  if (!canWrite) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot install connectors' });
  }

  const created = await ctx.connectorModel.create({
    identifier: params.identifier,
    isEnabled: true,
    metadata,
    name: params.name,
    sourceType: params.sourceType as any,
    status: ConnectorStatus.connected,
  });
  return { connectorId: created.id, writable: true };
}

/** Map builtin manifest humanIntervention → default ConnectorToolPermission */
function resolveDefaultPermission(humanIntervention: unknown): ConnectorToolPermission {
  if (humanIntervention === 'required' || humanIntervention === 'always') {
    return ConnectorToolPermission.needs_approval;
  }
  return ConnectorToolPermission.auto;
}
