import { createGmailConnectorClient, hasGmailReadPermission } from '@lobechat/connector-data/gmail';
import { getComposioAppByIdentifier } from '@lobechat/const';
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

import { findComposioAccountConflict } from './_helpers/composioAccountBinding';
import { removeComposioProjection } from './_helpers/composioProjection';
import { assertConnectorMaintainable } from './_helpers/connectorManagePolicy';

const composioDbProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
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
    ctx: { ...ctx, connectorModel, connectorToolModel, pluginModel },
  });
});

// Stored plugin listings do not require the external Composio service to be configured.
const composioProcedure = composioDbProcedure.use(async (opts) =>
  opts.next({ ctx: { composioClient: getComposioClient() } }),
);

// Writes: in a workspace, require at least the member role (blocks viewers).
// Personal mode passes through. The workspace connector policy is layered on
// top per-mutation via `resolveComposioWriteTarget` (mirrors the native
// connector router's connectorWriteProcedure + assertConnectorMaintainable).
const composioWriteProcedure = composioProcedure.use(requireWorkspaceRoleWhenScoped('member'));

interface ComposioWriteRef {
  agentId?: string;
  /** The Composio account the write is about, when it already exists. */
  connectedAccountId?: string;
  identifier: string;
}

/** The connector row a Composio write updates or removes; null when it creates one. */
type ComposioWriteTarget = Awaited<ReturnType<ConnectorModel['findManageableByIdentifier']>>;

/**
 * Resolve the connector row a Composio write touches, and assert the caller may
 * maintain it under the workspace connector policy (members co-maintain shared
 * rows unless an admin restricted it; private and agent-scoped rows keep the
 * creator-or-owner rule). The write then mutates exactly this row, so the
 * check and the change can never land on two different rows.
 *
 * `connectedAccountId` (refresh, removal) picks the row holding that account:
 * a member with a private connection may also see a shared one of the same
 * identifier, and Settings lists the shared account from the plugin projection.
 * Without it (a new connection) the caller's own private row wins over the
 * shared one; checking the shared row instead would let `admins_only` block a
 * member from reconnecting a connector that is theirs alone.
 *
 * The account itself is then bound to that row by id, not by the identifier
 * the request names ({@link findComposioAccountConflict}): the remote delete
 * acts on the account id alone, so a write naming a teammate's private
 * account, or an account another connector runs, is refused.
 *
 * Checked BEFORE any external side effect (Composio account link/delete). The
 * policy is a no-op in personal mode.
 */
async function resolveComposioWriteTarget(
  ctx: {
    connectorModel: ConnectorModel;
    pluginModel: PluginModel;
    serverDB: LobeChatDatabase;
    userId: string;
    workspaceId?: string | null;
    workspaceRole?: string;
  },
  { agentId, connectedAccountId, identifier }: ComposioWriteRef,
): Promise<ComposioWriteTarget> {
  const target = await ctx.connectorModel.findManageableByIdentifier(
    identifier,
    agentId,
    connectedAccountId,
  );

  if (connectedAccountId) {
    // Only a base connection has a legacy plugin projection to act on.
    const conflict = await findComposioAccountConflict(
      ctx,
      target,
      connectedAccountId,
      agentId ? undefined : () => ctx.pluginModel.queryComposioMirrors([identifier]),
    );
    if (conflict) throw conflict;
  }
  if (!ctx.workspaceId) return target;

  await assertConnectorMaintainable(ctx, {
    agentId,
    userId: target?.userId,
    visibility: target?.visibility,
  });
  return target;
}

type ComposioToolInput = {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
};

/**
 * Rejects connector identities that are not an exact member of the supported Composio catalog.
 *
 * This validates both fields so an unsupported toolkit cannot be smuggled through a supported
 * identifier before an external account is created or local connector state is written.
 */
const assertSupportedComposioApp = (identifier: string, appSlug: string): void => {
  const app = getComposioAppByIdentifier(identifier);
  if (app?.appSlug.toLowerCase() === appSlug.toLowerCase()) return;

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Unsupported Composio app: ${identifier}`,
  });
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
    /** The row {@link resolveComposioWriteTarget} authorized; null creates one. */
    existing: ComposioWriteTarget;
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
  // row, a personal connection the base row — never crossing scopes. The row is
  // found in any visibility: a connector switched to private must still be
  // updated here, or the upsert would create a second, public row for the same
  // account and republish the private connection to the workspace.
  const { existing } = params;
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

      assertSupportedComposioApp(identifier, appSlug);

      if (agentId)
        await assertCanEditAgent(ctx.serverDB, userId, agentId, ctx.workspaceId ?? undefined);
      // Block overwriting another member's workspace connection before creating
      // the remote Composio account.
      const existing = await resolveComposioWriteTarget(ctx, { agentId, identifier });

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
      // `allowMultiple` for agent connections: Composio rejects a second linked
      // account for the same (user entity, auth config) unless this is set. An
      // agent connector is intentionally a *separate* account from the user's
      // (and from other agents'), all under the same Composio user entity but
      // distinguished by connectedAccountId — so agent links must allow multiple.
      // Personal connections keep the default (one account per auth config).
      const connReq = await (ctx.composioClient.connectedAccounts as any).link(
        userId,
        authConfigId,
        { callbackUrl, ...(agentId ? { allowMultiple: true } : {}) },
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

      // Legacy plugin-table projection is personal-only (no agent_id column), so
      // skip it for agent connections — the runtime resolves those off the
      // agent-scoped connector row's metadata instead.
      if (!agentId) {
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
        existing,
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
      // can't grief another member's Composio connection. The row holding this
      // account is the one removed below.
      const existing = await resolveComposioWriteTarget(ctx, input);
      try {
        await (ctx.composioClient.connectedAccounts as any).delete(input.connectedAccountId);
      } catch (error) {
        console.warn('[Composio] Failed to delete remote connection:', error);
      }

      // Agent connections have no plugin-table row; only remove the base plugin
      // projection for personal connections.
      if (!input.agentId) {
        await removeComposioProjection(ctx.pluginModel, {
          connectedAccountId: input.connectedAccountId,
          identifier: input.identifier,
          visibility: existing?.visibility,
        });
      }
      // Tools cascade.
      if (existing) await ctx.connectorModel.delete(existing.id);

      return { success: true };
    }),

  getComposioPlugins: composioDbProcedure.query(async ({ ctx }) => {
    const allPlugins = await ctx.pluginModel.query();
    return allPlugins.filter((plugin) => plugin.customParams?.composio);
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
        const appSlug = account?.toolkit?.slug || '';
        const status = (account?.status || 'PENDING') as string;
        let gmailReadPermission: boolean | undefined;

        if (appSlug.toLowerCase() === 'gmail' && status === 'ACTIVE') {
          try {
            const gmailClient = createGmailConnectorClient({
              composio: ctx.composioClient,
              connectedAccountId: input.connectedAccountId,
              userId: ctx.userId,
            });
            const gmailAccount = await gmailClient.getAccount();
            gmailReadPermission = hasGmailReadPermission(gmailAccount.scopes);
          } catch (error) {
            // Permission introspection is advisory: a transient Composio lookup failure must not
            // downgrade an otherwise active connection or trap the OAuth polling loop.
            console.warn('[Composio] Failed to inspect Gmail permissions:', error);
          }
        }

        return {
          appSlug,
          connectedAccountId: input.connectedAccountId,
          error: undefined as 'AUTH_ERROR' | undefined,
          gmailReadPermission,
          status,
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
      const existing = await resolveComposioWriteTarget(ctx, input);
      if (!input.agentId) {
        await removeComposioProjection(ctx.pluginModel, {
          connectedAccountId: existing?.metadata?.composio?.connectedAccountId,
          identifier: input.identifier,
          visibility: existing?.visibility,
        });
      }
      if (existing) await ctx.connectorModel.delete(existing.id);
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

      assertSupportedComposioApp(identifier, appSlug);

      if (agentId)
        await assertCanEditAgent(ctx.serverDB, ctx.userId, agentId, ctx.workspaceId ?? undefined);
      // The row holding this account: refreshing a shared account must not
      // overwrite the caller's private connection of the same app.
      const existing = await resolveComposioWriteTarget(ctx, {
        agentId,
        connectedAccountId,
        identifier,
      });

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

      // Personal-only plugin projection: skip for agent connections (see
      // createConnection). The agent row's metadata is the runtime source.
      // Updating by identifier rewrites every member's projection row of the
      // app; a private connection is the caller's alone, so it refreshes only
      // the caller's own row and leaves a teammate's legacy connection intact.
      if (!agentId) {
        if (existingPlugin && existing?.visibility !== 'private') {
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
        existing,
        identifier,
        label,
        replaceTools: true,
        tools,
      });

      return { savedCount: tools.length };
    }),
});

export type ComposioRouter = typeof composioRouter;
