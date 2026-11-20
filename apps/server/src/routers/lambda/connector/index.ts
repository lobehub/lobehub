import { builtinTools } from '@lobechat/builtin-tools';
import { getComposioAppByIdentifier, hasCallableMcpEndpoint } from '@lobechat/const';
import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import type { ConnectorVisibility } from '@lobechat/types';
import { CONNECTOR_VISIBILITIES, upsertPluginMode } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import {
  EvalConnectorUpdateError,
  withoutEvalConnectorMarker,
} from '@/database/models/connectorEval';
import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
  ConnectorToolPermission,
} from '@/database/schemas';
import { getComposioClient } from '@/libs/composio';
import { inferCrudType } from '@/libs/mcp/utils';
import { mergeRouters, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getConnectorRedirectUri } from '@/server/services/connector/oauth';
import { loadConnectorPresentation } from '@/server/services/connector/presentation';
import {
  syncConnectorToolsById,
  writeConnectorToolSyncInputs,
} from '@/server/services/connector/sync';
import {
  removeByConnector,
  scheduleRefreshByConnector,
} from '@/server/services/inboundWebhook/lifecycle';
import {
  DeviceMcpManifestInputSchema,
  getDeviceMcpManifest,
} from '@/server/services/mcp/deviceManifest';
import {
  McpBoundDeviceUnavailableError,
  McpDeviceUnavailableError,
} from '@/server/services/mcp/deviceTunnel';
import {
  resolveConnectorAuthorizerId,
  resolveUserDisplayMap,
  withServerOwnedMetadata,
} from '@/server/utils/connectorAttribution';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { toClientToolSyncInputs } from '../_helpers/clientToolSyncInputs';
import { findComposioAccountConflict } from '../_helpers/composioAccountBinding';
import { removeComposioProjection } from '../_helpers/composioProjection';
import {
  assertBoundDeviceOperable,
  assertConnectorDeviceBindingAllowed,
} from '../_helpers/connectorDeviceBinding';
import { toConnectorEditDetail } from '../_helpers/connectorEditDetail';
import {
  assertConnectorCredentialsManageable,
  assertConnectorMaintainable,
  canManageWorkspaceConnectors,
  getConnectorMemberManage,
  isWorkspaceConnectorAdmin,
} from '../_helpers/connectorManagePolicy';
import { resolveDefaultPermission } from '../_helpers/connectorToolPermission';
import { resolveVisibilityChange, resolveWriteVisibility } from '../_helpers/connectorVisibility';
import { upsertConnectorEntry } from '../_helpers/upsertConnectorEntry';
import { connectorAccountProcedures } from './accounts';
import { connectorAgentScopeRouter } from './agentScope';
import { connectorProcedure, connectorWriteProcedure } from './procedures';
import { connectorRunRouter } from './run';

/** Per-connector DB reads and writes a request runs at once, however many rows it covers. */
const DB_CONCURRENCY = 5;

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

const mcpConnectionTypeSchema = z.enum([
  ConnectorMcpConnectionType.http,
  ConnectorMcpConnectionType.stdio,
  ConnectorMcpConnectionType.cloud,
]);
const mcpServerUrlSchema = z.string().url();
const mcpStdioConfigSchema = z.object({
  args: z.array(z.string()).optional(),
  command: z.string(),
  env: z.record(z.string(), z.string()).optional(),
});

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
  mcpConnectionType: mcpConnectionTypeSchema.optional(),
  mcpServerUrl: mcpServerUrlSchema.optional(),
  mcpStdioConfig: mcpStdioConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  name: z.string().min(1).max(255),
  oidcConfig: oidcConfigSchema.optional(),
  sourceType: z.enum([
    ConnectorSourceType.builtin,
    ConnectorSourceType.custom,
    ConnectorSourceType.marketplace,
  ]),
  /**
   * Workspace only: `private` keeps the connector to its creator and their
   * private agents (私人); `public` (default) shares it with the workspace.
   * Ignored in personal mode and for agent-scoped connectors.
   */
  visibility: z.enum(CONNECTOR_VISIBILITIES).optional(),
});

const connectorCoreRouter = router({
  ...connectorAccountProcedures,
  // ── Queries ──────────────────────────────────────────────────────────────

  list: connectorProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.connectorModel.query();
    const presentation = await loadConnectorPresentation(connectors, ctx);

    // Attribution — resolve the member who authorized each connector (workspace
    // dimension), so the profile can tag "authorized by X". The ids come from
    // scope-checked rows the caller already sees.
    const authorMap = await resolveUserDisplayMap(
      ctx.serverDB,
      connectors.map((c) => resolveConnectorAuthorizerId(c)),
    );

    const toolsByConnector = await pMap(
      connectors,
      async (c) => {
        const tools = await ctx.connectorToolModel.queryByConnector(c.id);
        // Never ship decrypted OAuth tokens or the client secret to the browser.
        const { credentials: _credentials, oidcConfig, ...rest } = c;
        const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
        const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
        return {
          ...rest,
          ...presentation.get(c.id),
          authorizedByAvatar: author?.avatar ?? null,
          authorizedByName: author?.name ?? null,
          oidcConfig: safeOidcConfig,
          tools,
        };
      },
      { concurrency: DB_CONCURRENCY },
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
      const presentation = await loadConnectorPresentation(connectors, ctx);

      // Attribution — the member who authorized each agent-scoped connector, so
      // a teammate viewing the agent sees "authorized by X" on each chip.
      const authorMap = await resolveUserDisplayMap(
        ctx.serverDB,
        connectors.map((c) => resolveConnectorAuthorizerId(c)),
      );

      return pMap(
        connectors,
        async (c) => {
          const tools = await ctx.connectorToolModel.queryByConnector(c.id);
          const { credentials: _credentials, oidcConfig, ...rest } = c;
          const safeOidcConfig = oidcConfig
            ? { ...oidcConfig, clientSecret: undefined }
            : oidcConfig;
          const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
          return {
            ...rest,
            ...presentation.get(c.id),
            authorizedByAvatar: author?.avatar ?? null,
            authorizedByName: author?.name ?? null,
            oidcConfig: safeOidcConfig,
            tools,
          };
        },
        { concurrency: DB_CONCURRENCY },
      );
    }),

  /**
   * List every agent-OWNED connector in the current scope (all agents at once),
   * so the unified connector-settings page can show "which connector belongs to
   * which agent" without querying one agent at a time. Each row keeps its
   * `agentId` and is enriched with the owning agent's `agentTitle`/`agentAvatar`
   * for attribution badges. Scope-correct via `ConnectorModel.ownership()` (and
   * `AgentModel.ownership()` for the titles) — a workspace context only returns
   * that workspace's agent connectors ( /).
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
    // connector inventory never leaks across members.
    const agentMetas = agentIds.length > 0 ? await agentModel.getAgentAvatarsByIds(agentIds) : [];
    const agentMetaById = new Map(agentMetas.map((m) => [m.id, m]));
    const visibleConnectors = connectors.filter((c) => !!c.agentId && agentMetaById.has(c.agentId));
    const presentation = await loadConnectorPresentation(visibleConnectors, ctx);

    return pMap(
      visibleConnectors,
      async (c) => {
        const tools = await ctx.connectorToolModel.queryByConnector(c.id);
        const { credentials: _credentials, oidcConfig, ...rest } = c;
        const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
        const meta = agentMetaById.get(c.agentId!);
        return {
          ...rest,
          ...presentation.get(c.id),
          agentAvatar: meta?.avatar ?? null,
          agentName: meta?.name ?? null,
          agentTitle: meta?.title ?? null,
          oidcConfig: safeOidcConfig,
          tools,
        };
      },
      { concurrency: DB_CONCURRENCY },
    );
  }),

  /**
   * Return the connector record with decrypted user-set credentials so the
   * edit form can pre-fill accurately (see {@link toConnectorEditDetail} for
   * what is stripped). Only the connector owner can call this.
   */
  // Member-gated even though it's a query: it returns decrypted credentials
  // for edit prefill, so a creator later downgraded to viewer must not reach it.
  getForEdit: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Edit-read returns decrypted credentials — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const tools = await ctx.connectorToolModel.queryByConnector(connector.id);
      return toConnectorEditDetail(connector, tools);
    }),

  /**
   * Test an MCP server that runs on the user's device (an HTTP server set to
   * connect through it, or one bound to a device): its manifest, read on the
   * device its calls will run on. A mutation so the credentials travel in the
   * body, not the URL.
   */
  getDeviceMcpManifest: wsCompatProcedure
    .use(serverDatabase)
    // Starts the server on a device: read-only viewers never operate one
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(DeviceMcpManifestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBoundDeviceOperable(ctx, input.boundDeviceId);
      return getDeviceMcpManifest({
        connection: input,
        serverDB: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),

  /**
   * The exact redirect URI the server will send to the OAuth/DCR endpoints.
   * The Add modal must display THIS value (not a client-derived origin) so the
   * URI the user registers matches the one used at authorize time.
   */
  getRedirectUri: wsCompatProcedure.query(() => ({ redirectUri: getConnectorRedirectUri() })),

  /**
   * The caller's standing under the workspace connector policy: whether they may
   * maintain shared connectors, and whether they may change who can. Lets the
   * settings list disable what the server would reject instead of failing a click.
   */
  getManagePolicy: connectorProcedure.query(async ({ ctx }) => {
    const [canManage, memberManage] = await Promise.all([
      canManageWorkspaceConnectors(ctx),
      getConnectorMemberManage(ctx),
    ]);
    return {
      canEditPolicy: !!ctx.workspaceId && isWorkspaceConnectorAdmin(ctx),
      canManage,
      memberManage,
    };
  }),

  /** Owners and admins choose whether members may maintain shared connectors. */
  updateManagePolicy: connectorProcedure
    .use(requireWorkspaceRoleWhenScoped('admin'))
    .input(z.object({ memberManage: z.enum(['all_members', 'admins_only']) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Connector policy applies to workspaces only',
        });
      }
      // A restricted API key must not rewrite who may change credentials.
      if (ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Restricted API keys cannot change the workspace connector policy',
        });
      }

      const workspaceModel = new WorkspaceModel(ctx.serverDB, ctx.userId);
      const previous = await workspaceModel.getConnectorMemberManage(ctx.workspaceId);
      await workspaceModel.updateConnectorMemberManage(ctx.workspaceId, input.memberManage);
      await new WorkspaceAuditLogModel(ctx.serverDB).create({
        action: 'security.policy_updated',
        metadata: { policy: 'connector.member_manage', previous, value: input.memberManage },
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return { memberManage: input.memberManage };
    }),

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
      // Drop any client-supplied `composio` block or `mountedByAgentId`: both
      // are server-owned. Trusting the first would let a member spoof
      // connector attribution, or name a teammate's account on a private row
      // of their own so its real owner can no longer refresh or remove it.
      // Trusting the second would let a member mount a shared row on a
      // teammate's private agent, past `mountToAgent`'s checks, and have it
      // outrank the owner's private connector.
      metadata:
        withoutEvalConnectorMarker(withServerOwnedMetadata(input.metadata, undefined)) ?? null,
      name: input.name,
      oidcConfig: input.oidcConfig ?? null,
    };

    // Idempotent on (scope, visibility, identifier): re-adding or
    // re-authorizing the same connector updates the existing row. Status
    // resets to `disconnected` — the OAuth callback / tool sync promotes it
    // back to `connected` on success.
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
    //
    // A private connector is looked up among the caller's own private rows, so
    // adding one never rewrites the shared connector of the same identifier.
    const visibility = agentId ? 'public' : resolveWriteVisibility(ctx, input.visibility);
    const row = {
      ...fields,
      isEnabled: input.isEnabled ?? true,
      sourceType: input.sourceType,
      status: ConnectorStatus.disconnected,
    };
    // Adding a workspace connector follows the member policy. Re-adding over
    // someone else's row rewrites its server/command while the row stays theirs
    // (their runs would execute it, and they could read the new credentials), so
    // that keeps the creator-or-owner rule. A private connector is the caller's
    // own and skips the member policy.
    const assertWritable = async (existing?: {
      agentId: string | null;
      metadata?: Record<string, unknown> | null;
      userId: string;
      visibility: ConnectorVisibility;
    }) => {
      if (existing && existing.userId !== ctx.userId)
        await assertConnectorCredentialsManageable(ctx, existing);
      else
        await assertConnectorMaintainable(ctx, { agentId, userId: existing?.userId, visibility });
      // An upsert keeps the row's creator and visibility (an agent's row may
      // be a private copy)
      await assertConnectorDeviceBindingAllowed(ctx, {
        connector: {
          userId: existing?.userId ?? ctx.userId,
          visibility: existing?.visibility ?? visibility,
        },
        metadata: input.metadata,
        previous: existing
          ? { metadata: existing.metadata, visibility: existing.visibility }
          : undefined,
      });
    };
    // `isNew` lets clients tell a fresh row from an updated pre-existing one —
    // client-side caches can't answer this reliably (the connector list may
    // not be fetched yet), and rollback-on-sync-failure must never delete a
    // connector the user already had.
    // Nothing when the row is gone by its update (see the retry below).
    const reAdd = async (existing: {
      agentId: string | null;
      id: string;
      metadata?: Record<string, unknown> | null;
      userId: string;
      visibility: ConnectorVisibility;
    }) => {
      await assertWritable(existing);
      // The row keeps its server-owned metadata (its Composio account, its
      // mount): the client never authors it, and dropping the account here
      // would leave its legacy plugin projection as the only holder, which
      // publishes a private connection to the workspace again.
      const metadata =
        withServerOwnedMetadata(row.metadata ?? {}, existing.metadata) ?? row.metadata;
      const updated = await ctx.connectorModel.update(existing.id, {
        ...row,
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
      });
      return updated ? { id: existing.id, isNew: false } : undefined;
    };

    const add = async () => {
      const existing = await ctx.connectorModel.findScopedByIdentifier(
        input.identifier,
        agentId,
        undefined,
        visibility,
      );
      if (existing) return reAdd(existing);
      await assertWritable();

      if (agentId) {
        const created = await ctx.connectorModel.create({
          ...row,
          agentId,
          identifier: input.identifier,
          visibility,
        });
        return { id: created.id, isNew: true };
      }
      // A base row is claimed under the identifier lock every base-row writer
      // takes (an Agent Builder install among them), so concurrent adds create
      // it once. The claim holds the identifier within this row's visibility.
      const claim = await ctx.connectorModel.createUnlessIdentifierHeld({
        ...row,
        identifier: input.identifier,
        visibility,
      });
      if ('holder' in claim) return reAdd(claim.holder);
      return { id: claim.created.id, isNew: true };
    };

    const added = await add();
    if (added) return added;
    // The row the re-add read was deleted before its update (an Agent Builder
    // install replaces a stale unfinished one under the identifier lock): start
    // over once, against the fresh replacement no install takes over in turn.
    const retried = await add();
    if (retried) return retried;
    throw new TRPCError({ code: 'CONFLICT', message: 'Connector changed, try again' });
  }),

  /** Update connector configuration while preserving server-resolved OAuth state. */
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
          // Allow `null` here so an edit can clear credentials (switch to no-auth),
          // drop an OAuth client (undoing a failed switch to OAuth), or put back
          // an endpoint-less row (undoing a failed install over a legacy plugin's
          // tool projection).
          .extend({
            credentials: connectorCredentialsInputSchema.nullish(),
            mcpConnectionType: mcpConnectionTypeSchema.nullish(),
            mcpServerUrl: mcpServerUrlSchema.nullish(),
            mcpStdioConfig: mcpStdioConfigSchema.nullish(),
            oidcConfig: oidcConfigSchema.nullish(),
            // `create` re-sources the row it upserts, so undoing a failed custom
            // install over a legacy marketplace projection puts its source back.
            // Only between the two install sources `create` moves a row across.
            sourceType: z
              .enum([ConnectorSourceType.custom, ConnectorSourceType.marketplace])
              .optional(),
          }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // A patch may keep the stored credentials while repointing the server
      // URL, which would send them elsewhere — creator/owner only.
      await assertConnectorCredentialsManageable(ctx, target);

      const { credentials, visibility: requestedVisibility, ...patch } = input.patch;
      const visibility = await resolveVisibilityChange(ctx, target, requestedVisibility);
      const changesUrl =
        patch.mcpServerUrl !== undefined && patch.mcpServerUrl !== target.mcpServerUrl;
      if (
        changesUrl &&
        target.oidcConfig &&
        target.oidcConfig.scheme !== 'pre_registration' &&
        !patch.oidcConfig?.clientId
      ) {
        // An automatic client is registered with the old authorization server.
        // A new endpoint must resolve its own client and initial scopes.
        patch.oidcConfig = { scheme: 'dcr' };
      } else if (
        patch.oidcConfig &&
        !patch.oidcConfig.clientId &&
        target.oidcConfig &&
        target.oidcConfig.scheme !== 'pre_registration' &&
        patch.oidcConfig.scheme === target.oidcConfig.scheme
      )
        // The edit form resends the automatic client it shows without the
        // fields the server resolved: keep the stored client and its accounts.
        // A connector switching to OAuth, or to another scheme, stores the new
        // one and waits for its authorization.
        delete patch.oidcConfig;
      if (patch.oidcConfig?.clientId && patch.oidcConfig.clientId === target.oidcConfig?.clientId) {
        // A form/CLI may resend the client without its resolved server fields.
        // Undefined fields mean omitted, including an unfilled client secret.
        patch.oidcConfig = {
          ...target.oidcConfig,
          ...Object.fromEntries(
            Object.entries(patch.oidcConfig).filter(([, value]) => value !== undefined),
          ),
        };
      }
      // Checked against who will run the connector after this write
      await assertConnectorDeviceBindingAllowed(ctx, {
        connector: { userId: target.userId, visibility: visibility ?? target.visibility },
        metadata: patch.metadata,
        previous: { metadata: target.metadata, visibility: target.visibility },
      });
      // Keep the stored, server-owned `composio` block and mount and ignore
      // whatever the client sent, so an edit can never repoint the row at
      // another Composio account, spoof (or silently clear) the connector's
      // authorizer, or mount the row on an agent past `mountToAgent`'s checks.
      // Untouched when the patch omits metadata.
      const metadata = withServerOwnedMetadata(patch.metadata, target.metadata);
      // The destination slot is claimed under the identifier lock every
      // base-row writer takes: two members sharing private connectors of one
      // identifier at once never both land in the shared slot
      if (visibility) {
        const changed = await ctx.connectorModel.changeVisibilityUnlessHeld(
          input.id,
          target.identifier,
          visibility,
        );
        if ('holder' in changed)
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              visibility === 'public'
                ? `The workspace already shares a "${target.identifier}" connector`
                : `You already have a private "${target.identifier}" connector`,
          });
      }
      try {
        await ctx.connectorModel.update(input.id, {
          ...patch,
          ...(patch.metadata === undefined ? {} : { metadata }),
          // A new OAuth client needs a new authorization: the row stays
          // disconnected until the callback connects it, so a client can tell
          // a successful callback from a canceled one
          ...(patch.oidcConfig ? { status: ConnectorStatus.disconnected } : {}),
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
        const headersChanged =
          patch.metadata !== undefined &&
          JSON.stringify(metadata?.customHeaders) !==
            JSON.stringify(target.metadata?.customHeaders);
        if (credentials !== undefined || headersChanged) {
          scheduleRefreshByConnector(
            ctx.serverDB,
            { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
            input.id,
          );
        }
      } catch (error) {
        if (error instanceof EvalConnectorUpdateError)
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        throw error;
      }
    }),

  delete: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!target) return;
      await assertConnectorMaintainable(ctx, target);

      const connectedAccountId = target.metadata?.composio?.connectedAccountId;
      // The account this row names may also be held by other rows: a
      // teammate's private connector, or one the caller may not maintain. Then
      // the remote account and its projection are not this row's to remove;
      // the row itself still goes.
      if (
        connectedAccountId &&
        !(await findComposioAccountConflict(ctx, target, connectedAccountId))
      ) {
        try {
          await getComposioClient().connectedAccounts.delete(connectedAccountId);
        } catch (error) {
          // Keep deletion recoverable when the remote account is already gone or
          // Composio is temporarily unavailable. This matches deleteConnection:
          // the local connector must not become impossible to remove.
          console.warn('[Composio] Failed to delete remote connection:', error);
        }

        // Personal Composio connections still carry the legacy plugin projection.
        // Agent-scoped connections never create one, so do not remove a base
        // plugin that may belong to a separate personal connection.
        if (!target.agentId) {
          await removeComposioProjection(ctx.pluginModel, { ...target, connectedAccountId });
        }
      }

      await removeByConnector(
        ctx.serverDB,
        { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
        input.id,
      );
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
    .input(
      z.object({
        id: z.string().uuid(),
        /** An install: `auto` tools the server no longer lists are dropped. */
        pruneMissingAutoTools: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Syncing rewrites the connector's tool rows and refreshes OAuth tokens —
      // a maintenance operation, gated like delete/reset.
      await assertConnectorMaintainable(ctx, target);
      try {
        return await syncConnectorToolsById(input.id, ctx, {
          pruneMissingAutoTools: input.pruneMissingAutoTools,
        });
      } catch (err: any) {
        // Keep actionable rejections and their structured reason for the client.
        if (err instanceof TRPCError) throw err;
        // No device can list it now (the bound one offline or gone, none
        // online): a precondition the user fixes, with the reason as written
        if (
          err instanceof McpBoundDeviceUnavailableError ||
          err instanceof McpDeviceUnavailableError
        )
          throw new TRPCError({ cause: err, code: 'PRECONDITION_FAILED', message: err.message });
        throw new TRPCError({
          cause: err,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch tools from MCP server: ${err?.message ?? 'unknown error'}`,
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
      await assertConnectorMaintainable(ctx, target);

      const tools = await ctx.connectorToolModel.queryByConnector(input.id);
      await pMap(
        tools,
        (t) => ctx.connectorToolModel.updatePermission(t.id, ConnectorToolPermission.auto),
        { concurrency: DB_CONCURRENCY },
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
      // A tool whose connector is outside the caller's scope is not theirs to gate.
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      await assertConnectorMaintainable(ctx, owner);

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
            /**
             * A manifest tool's `humanIntervention` (cloud marketplace installs):
             * `required` / `always`, or rules or a dynamic config that can ask
             * for either, make a newly synced tool need approval. One that can
             * ask for `always` keeps it on every sync, since no approval mode
             * waives it.
             */
            humanIntervention: z.unknown().optional(),
            inputSchema: z.record(z.string(), z.unknown()).optional(),
            toolName: z.string(),
            /** The MCP tool's `_meta.ui.visibility`, when it declares one. */
            visibility: z.array(z.string()).optional(),
            mcpAppMeta: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
        /** An install: `auto` tools the client no longer lists are dropped. */
        pruneMissingAutoTools: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Same gate as `syncTools` — rewrites the connector's tool rows.
      await assertConnectorMaintainable(ctx, target);

      return writeConnectorToolSyncInputs(
        input.id,
        await toClientToolSyncInputs(input.tools, ctx.userId, target.metadata),
        ctx,
        { pruneMissingAutoTools: input.pruneMissingAutoTools },
      );
    }),

  /**
   * Bootstrap a connector entry for a builtin tool (lobe-creds, lobe-local-system, etc.)
   * by reading its manifest from @lobechat/builtin-tools.
   * Idempotent — safe to call on every open of the detail panel.
   */
  syncBuiltinTool: connectorProcedure
    .input(z.object({ identifier: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
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

      // A connector installed for this identifier (an endpoint plus the tools
      // it synced from its own server) supersedes the plugin row, whose
      // manifest a reinstall leaves as it was. Projecting that manifest would
      // put the old tools and display fields back over the synced ones. In a
      // workspace that includes the caller's own private row, which
      // `upsertConnectorEntry` would otherwise refresh in place.
      const [shared] = await ctx.connectorModel.queryByIdentifiers([input.identifier]);
      const installed =
        shared && hasCallableMcpEndpoint(shared)
          ? shared
          : ctx.workspaceId
            ? await ctx.connectorModel.findScopedByIdentifier(
                input.identifier,
                undefined,
                undefined,
                'private',
              )
            : null;
      if (installed && hasCallableMcpEndpoint(installed)) {
        return { connectorId: installed.id, toolCount: 0 };
      }

      // Legacy plugin rows can outlive a provider's removal from the Composio catalog. Do not
      // project those rows back into user_connectors when the detail panel performs its sync.
      if (plugin.customParams?.composio && !getComposioAppByIdentifier(input.identifier)) {
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
        composio: plugin.customParams?.composio,
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

export const connectorRouter = mergeRouters(
  connectorCoreRouter,
  connectorAgentScopeRouter,
  connectorRunRouter,
);
