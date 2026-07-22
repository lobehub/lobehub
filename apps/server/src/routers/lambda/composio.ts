import type { LobeChatDatabase } from '@lobechat/database';
import { type ToolManifest } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerComposioAuthConfigId } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import {
  type ComposioConnectorMetadata,
  type ConnectorMetadata,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import { getComposioClient } from '@/libs/composio';
import { inferCrudType } from '@/libs/mcp/utils';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const composioProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const client = getComposioClient();
  const wsId = ctx.workspaceId ?? undefined;
  // Workspace-scoped. A Composio connection bound to a workspace agent (or a
  // workspace's base tools) must land as a workspace-dimension row
  // (workspace_id = wsId); otherwise the correctly workspace-scoped runtime
  // (ComposioService/aiAgent build the model WITH wsId) can never resolve it and
  // the tool shows as "not installed". Personal mode (wsId undefined) is
  // unchanged — the model falls back to `workspace_id IS NULL`. No gatekeeper:
  // Composio rows carry no encrypted credentials (the account lives in plaintext
  // `metadata.composio.connectedAccountId`).
  const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, wsId);
  const connectorModel = new ConnectorModel(ctx.serverDB, ctx.userId, wsId);
  const connectorToolModel = new ConnectorToolModel(ctx.serverDB, ctx.userId, wsId);

  return opts.next({
    ctx: { ...ctx, composioClient: client, connectorModel, connectorToolModel, pluginModel },
  });
});

// Writes: in a workspace, require at least the member role (blocks viewers).
// Personal mode passes through. Row-level creator/owner enforcement is layered
// on top per-mutation via `assertComposioRowManageable` (mirrors the native
// connector router's connectorWriteProcedure + assertWorkspaceRowManageable).
const composioWriteProcedure = composioProcedure.use(requireWorkspaceRoleWhenScoped('member'));

/**
 * Before mutating (overwriting/deleting) a Composio connection in a workspace,
 * assert the caller may manage the existing row: creator or workspace owner.
 * `buildWorkspaceWhere` makes workspace rows writable workspace-wide, so without
 * this any member could overwrite/remove another member's connection by
 * identifier/agentId. Checked BEFORE any external side effect (Composio account
 * link/delete). No-op in personal mode.
 */
async function assertComposioRowManageable(
  ctx: {
    connectorModel: ConnectorModel;
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  identifier: string,
  agentId?: string,
): Promise<void> {
  if (!ctx.workspaceId) return;
  const existing = await ctx.connectorModel.findScopedByIdentifier(identifier, agentId);
  if (existing) assertWorkspaceRowManageable(ctx, existing.userId, 'connector');
}

type ComposioToolInput = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
};

/**
 * Dual-write helper: mirror a Composio connection into `user_connectors`
 * (+ `user_connector_tools`) so the runtime can resolve it without touching the
 * plugin table. Idempotent on (userId, identifier). The plugin-table write is
 * kept by the callers for backward compatibility; this only adds the connector
 * projection so new connections run off metadata while old ones fall back.
 */
async function upsertComposioConnector(
  connectorModel: ConnectorModel,
  connectorToolModel: ConnectorToolModel,
  params: {
    /**
     * When set, the Composio connection is bound to this agent: the account
     * (`metadata.composio.connectedAccountId`) lands on the agent-scoped
     * connector row and shadows the base one at runtime (Agent > Personal). The
     * legacy `user_installed_plugins` projection can't carry an agent scope, so
     * agent connections skip it (the runtime resolves off metadata).
     */
    agentId?: string;
    composio: ComposioConnectorMetadata;
    identifier: string;
    label: string;
    /**
     * When true, the connector's tool set is REPLACED by `tools`: rows missing
     * from the latest list are deleted. Use for the authoritative refresh
     * (updateComposioPlugin), where the runtime manifest is built from these
     * rows, so a shrunk/emptied tool list must not leave stale tools advertised.
     * Leave false for the pre-auth seed (createConnection), whose tool list may
     * be incomplete or empty before authorization.
     */
    replaceTools?: boolean;
    tools?: ComposioToolInput[];
  },
): Promise<void> {
  const metadata: ConnectorMetadata = {
    avatar: '🔌',
    composio: params.composio,
    description: `Composio: ${params.label}`,
  };

  const status =
    params.composio.status === 'ACTIVE'
      ? ConnectorStatus.connected
      : params.composio.status === 'FAILED'
        ? ConnectorStatus.error
        : ConnectorStatus.disconnected;

  // Exact-scope idempotency: an agent connection updates/creates the agent's own
  // row, a personal connection the base row — never crossing scopes.
  const existing = await connectorModel.findScopedByIdentifier(params.identifier, params.agentId);
  let connectorId: string;
  if (existing) {
    await connectorModel.update(existing.id, {
      metadata,
      name: params.label,
      sourceType: ConnectorSourceType.marketplace,
      status,
    });
    connectorId = existing.id;
  } else {
    const created = await connectorModel.create({
      agentId: params.agentId ?? null,
      identifier: params.identifier,
      isEnabled: true,
      metadata,
      name: params.label,
      sourceType: ConnectorSourceType.marketplace,
      status,
    });
    connectorId = created.id;
  }

  if (params.tools) {
    if (params.tools.length > 0) {
      await connectorToolModel.upsertMany(
        connectorId,
        params.tools.map((t) => ({
          crudType: inferCrudType(t.name),
          description: t.description,
          inputSchema: t.inputSchema,
          toolName: t.name,
        })),
      );
    }

    // Replace (not merge) so tools removed upstream stop being advertised.
    if (params.replaceTools) {
      await connectorToolModel.deleteToolsNotIn(
        connectorId,
        params.tools.map((t) => t.name),
      );
    }
  }
}

/** Remove the connector projection for a Composio identifier (tools cascade). */
async function deleteComposioConnector(
  connectorModel: ConnectorModel,
  identifier: string,
  agentId?: string,
): Promise<void> {
  const existing = await connectorModel.findScopedByIdentifier(identifier, agentId);
  if (existing) await connectorModel.delete(existing.id);
}

/**
 * Guard: the caller must OWN (have created) the agent before a Composio account
 * is bound to it. Uses `existsOwnedById` (creator-only) rather than the
 * visibility-aware `existsById`, so a member who can merely see a shared public
 * agent can't attach their account to it.
 */
async function assertCanEditAgent(
  db: LobeChatDatabase,
  userId: string,
  agentId: string,
  workspaceId?: string,
): Promise<void> {
  const agentModel = new AgentModel(db, userId, workspaceId);
  if (!(await agentModel.existsOwnedById(agentId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
  }
}

export const composioRouter = router({
  createConnection: composioWriteProcedure
    .input(
      z.object({
        /** Bind the connection to this agent (Agent > Personal). Requires edit rights. */
        agentId: z.string().optional(),
        appSlug: z.string(),
        identifier: z.string(),
        label: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { appSlug, identifier, label, agentId } = input;
      const { userId } = ctx;
      const isPersonalScope = !agentId && !ctx.workspaceId;

      if (agentId)
        await assertCanEditAgent(ctx.serverDB, userId, agentId, ctx.workspaceId ?? undefined);
      // Block overwriting another member's workspace connection before creating
      // the remote Composio account.
      await assertComposioRowManageable(ctx, identifier, agentId);

      const callbackUrl = `${process.env.APP_URL || process.env.NEXTAUTH_URL || ''}/api/composio/oauth/callback`;

      // Prefer a pre-configured auth config (e.g. a custom/white-label config
      // created in the Composio dashboard), pinned per toolkit via env. Falls
      // back to discovering an existing config for this toolkit, and finally to
      // auto-creating a Composio-managed one.
      let authConfigId = getServerComposioAuthConfigId(identifier);
      if (!authConfigId) {
        const authConfigs = await (ctx.composioClient.authConfigs as any).list();
        let authConfig = authConfigs?.items?.find(
          (c: any) => c.toolkit?.slug?.toLowerCase() === appSlug.toLowerCase(),
        );
        if (!authConfig) {
          authConfig = await (ctx.composioClient.authConfigs as any).create(appSlug, {
            name: appSlug,
            type: 'use_composio_managed_auth',
          });
        }
        authConfigId = authConfig.id;
      }

      if (!authConfigId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to resolve a Composio auth config for "${appSlug}".`,
        });
      }

      // Composio-managed OAuth auth configs no longer support `initiate`; use
      // `link` (POST /api/v3/connected_accounts/link) to get the redirect URL.
      //
      // `allowMultiple`: Composio rejects a second linked account for the same
      // (user entity, auth config) unless this is set. Our Composio user entity
      // is the bare `userId` — it carries no workspace or agent dimension — so
      // EVERY scope beyond the user's personal one is necessarily an additional
      // account under that same entity, distinguished only by
      // connectedAccountId. That applies to workspace connections exactly as it
      // does to agent ones; omitting it there made "connect Gmail inside a
      // workspace" fail outright for anyone who had already connected Gmail
      // personally. Only a personal connection keeps the one-account default.
      const connReq = await (ctx.composioClient.connectedAccounts as any).link(
        userId,
        authConfigId,
        { callbackUrl, ...(isPersonalScope ? {} : { allowMultiple: true }) },
      );

      let rawTools: any[] = [];
      try {
        const toolsResp = await (ctx.composioClient.tools as any).getRawComposioTools({
          toolkits: [appSlug],
        });
        rawTools = toolsResp?.items || toolsResp || [];
      } catch {
        // tools may not be available before auth
      }

      const manifest: ToolManifest = {
        api: Array.isArray(rawTools)
          ? rawTools.map((tool: any) => ({
              description: tool.description || '',
              name: tool.slug || tool.name || '',
              parameters: tool.inputParameters ||
                tool.inputSchema || {
                  properties: {},
                  type: 'object',
                },
            }))
          : [],
        identifier,
        meta: {
          avatar: '🔌',
          description: `Composio: ${label}`,
          title: label,
        },
        type: 'default',
      };

      // The legacy plugin-table projection is personal-only — and not merely by
      // convention: `user_installed_plugins` is keyed by `(user_id,
      // identifier)`, so it structurally cannot hold the same plugin twice for
      // one user. Writing a workspace connection through it would upsert onto
      // the PERSONAL row (the conflict target ignores workspace_id, and the
      // update doesn't set it), silently repointing the user's personal
      // connection at the workspace's Composio account while leaving the
      // workspace with no row at all. So workspace connections skip it, the way
      // agent connections already do, and resolve off the connector row's
      // metadata instead — see `getComposioPlugins`, which unions both sources.
      if (isPersonalScope) {
        await ctx.pluginModel.create({
          customParams: {
            composio: {
              appSlug,
              authConfigId,
              connectedAccountId: connReq.id,
              // The user entity the account was linked under — used at runtime as
              // the Composio `userId` (see ComposioConnectorMetadata.linkedByUserId).
              linkedByUserId: userId,
              redirectUrl: connReq.redirectUrl,
              status: 'PENDING',
            },
          },
          identifier,
          manifest,
          source: 'composio',
          type: 'plugin',
        });
      }

      // Dual-write: mirror the (pending) connection into user_connectors so the
      // runtime can resolve it off metadata once it goes ACTIVE. Tools sync on
      // updateComposioPlugin; seed them here too when already fetched.
      await upsertComposioConnector(ctx.connectorModel, ctx.connectorToolModel, {
        agentId,
        composio: {
          appSlug,
          authConfigId,
          connectedAccountId: connReq.id,
          linkedByUserId: userId,
          redirectUrl: connReq.redirectUrl,
          status: 'PENDING',
        },
        identifier,
        label,
        tools: manifest.api.map((a) => ({
          description: a.description,
          inputSchema: a.parameters as Record<string, unknown>,
          name: a.name,
        })),
      });

      return {
        authConfigId,
        connectedAccountId: connReq.id,
        identifier,
        redirectUrl: connReq.redirectUrl,
      };
    }),

  deleteConnection: composioWriteProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        connectedAccountId: z.string(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Gate before deleting the remote account, so a non-creator/owner member
      // can't grief another member's Composio connection.
      await assertComposioRowManageable(ctx, input.identifier, input.agentId);
      try {
        await (ctx.composioClient.connectedAccounts as any).delete(input.connectedAccountId);
      } catch (error) {
        console.warn('[Composio] Failed to delete remote connection:', error);
      }

      // Only personal connections have a plugin-table row (see createConnection);
      // agent and workspace ones live solely in `user_connectors`. The delete is
      // ownership-scoped so it would be a no-op elsewhere anyway, but keeping the
      // condition aligned with the write side is what stops the two from drifting.
      if (!input.agentId && !ctx.workspaceId) await ctx.pluginModel.delete(input.identifier);
      await deleteComposioConnector(ctx.connectorModel, input.identifier, input.agentId);

      return { success: true };
    }),

  /**
   * Composio connections visible in the caller's scope, unioned from BOTH
   * stores — mirroring what the runtime already does in
   * `loadConnectedComposioIds`:
   *
   * - `user_installed_plugins`: the legacy projection, personal connections
   *   only (the table is keyed by `(user_id, identifier)` and has no workspace
   *   or agent dimension).
   * - `user_connectors`: everything else. Workspace connections are written
   *   only here, so without this union a workspace's own Composio connections
   *   would read as "not connected" in the skills dropdown, the skill store and
   *   `/settings/connector` — and the connect button would restart an OAuth
   *   flow that has already been completed.
   *
   * Plugin rows win on identifier collision: in personal scope both stores are
   * written, and the plugin row is the one the legacy client shape came from.
   */
  getComposioPlugins: composioProcedure.query(async ({ ctx }) => {
    const plugins = (await ctx.pluginModel.query()).filter(
      (plugin) => plugin.customParams?.composio,
    );

    const composioConnectors = (await ctx.connectorModel.query()).filter(
      (connector) => connector.metadata?.composio,
    );
    if (composioConnectors.length === 0) return plugins;

    const seen = new Set(plugins.map((plugin) => plugin.identifier));
    const tools = await ctx.connectorToolModel.queryByConnectorIds(
      composioConnectors.map((connector) => connector.id),
    );
    const toolsByConnector = new Map<string, typeof tools>();
    for (const tool of tools) {
      const bucket = toolsByConnector.get(tool.userConnectorId) ?? [];
      bucket.push(tool);
      toolsByConnector.set(tool.userConnectorId, bucket);
    }

    // Project connector rows into the legacy plugin shape the client renders,
    // so the union is invisible to callers.
    const projected = composioConnectors
      .filter((connector) => !seen.has(connector.identifier))
      .map((connector) => ({
        customParams: { composio: connector.metadata!.composio },
        identifier: connector.identifier,
        manifest: {
          api: (toolsByConnector.get(connector.id) ?? []).map((tool) => ({
            description: tool.description || '',
            name: tool.toolName,
            parameters: tool.inputSchema || { properties: {}, type: 'object' },
          })),
          identifier: connector.identifier,
          meta: {
            avatar: connector.metadata?.avatar || '🔌',
            description: connector.metadata?.description || `Composio: ${connector.name}`,
            title: connector.name,
          },
          type: 'default',
        },
        source: 'composio',
        type: 'plugin',
      }));

    return [...plugins, ...projected] as typeof plugins;
  }),

  getConnection: composioProcedure
    .input(
      z.object({
        connectedAccountId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const account = await (ctx.composioClient.connectedAccounts as any).get(
          input.connectedAccountId,
        );
        return {
          appSlug: account?.toolkit?.slug || '',
          connectedAccountId: input.connectedAccountId,
          error: undefined as 'AUTH_ERROR' | undefined,
          status: (account?.status || 'PENDING') as string,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isAuthError = errorMessage.includes('401') || errorMessage.includes('Unauthorized');

        if (isAuthError) {
          return {
            appSlug: '',
            connectedAccountId: input.connectedAccountId,
            error: 'AUTH_ERROR' as const,
            status: 'FAILED',
          };
        }
        throw error;
      }
    }),

  removeComposioPlugin: composioWriteProcedure
    .input(z.object({ agentId: z.string().optional(), identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertComposioRowManageable(ctx, input.identifier, input.agentId);
      if (!input.agentId) await ctx.pluginModel.delete(input.identifier);
      await deleteComposioConnector(ctx.connectorModel, input.identifier, input.agentId);
      return { success: true };
    }),

  updateComposioPlugin: composioWriteProcedure
    .input(
      z.object({
        /** Bind the connection to this agent (Agent > Personal). Requires edit rights. */
        agentId: z.string().optional(),
        appSlug: z.string(),
        authConfigId: z.string(),
        connectedAccountId: z.string(),
        identifier: z.string(),
        label: z.string(),
        redirectUrl: z.string().optional(),
        status: z.string(),
        tools: z.array(
          z.object({
            description: z.string().optional(),
            inputSchema: z.any().optional(),
            name: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const {
        identifier,
        label,
        appSlug,
        authConfigId,
        connectedAccountId,
        tools,
        status,
        redirectUrl,
        agentId,
      } = input;

      if (agentId)
        await assertCanEditAgent(ctx.serverDB, ctx.userId, agentId, ctx.workspaceId ?? undefined);
      await assertComposioRowManageable(ctx, identifier, agentId);

      const existingPlugin = await ctx.pluginModel.findById(identifier);

      const manifest: ToolManifest = {
        api: tools.map((tool) => ({
          description: tool.description || '',
          name: tool.name,
          parameters: tool.inputSchema || { properties: {}, type: 'object' },
        })),
        identifier,
        meta: existingPlugin?.manifest?.meta || {
          avatar: '🔌',
          description: `Composio: ${label}`,
          title: label,
        },
        type: 'default',
      };

      const customParams = {
        composio: {
          appSlug,
          authConfigId,
          connectedAccountId,
          // Refresh the link owner on every (re)connect: a workspace owner may
          // reconnect a member-created row, moving the Composio entity to the
          // owner even though the row's userId (creator) stays put.
          linkedByUserId: ctx.userId,
          redirectUrl,
          status,
        },
      };

      // Personal-only plugin projection: skip for agent AND workspace
      // connections (see createConnection — the table is keyed by
      // `(user_id, identifier)`, so a workspace write would land on the personal
      // row). Their connector-row metadata is the source of truth.
      if (!agentId && !ctx.workspaceId) {
        if (existingPlugin) {
          await ctx.pluginModel.update(identifier, { customParams, manifest });
        } else {
          await ctx.pluginModel.create({
            customParams,
            identifier,
            manifest,
            source: 'composio',
            type: 'plugin',
          });
        }
      }

      // Dual-write: project the active connection + tool list into the connector
      // tables so the runtime resolves this Composio server without the plugin
      // table. `tools` already carries the full manifest from the client.
      await upsertComposioConnector(ctx.connectorModel, ctx.connectorToolModel, {
        agentId,
        composio: {
          appSlug,
          authConfigId,
          connectedAccountId,
          linkedByUserId: ctx.userId,
          redirectUrl,
          status,
        },
        identifier,
        label,
        replaceTools: true,
        tools,
      });

      return { savedCount: tools.length };
    }),
});

export type ComposioRouter = typeof composioRouter;
