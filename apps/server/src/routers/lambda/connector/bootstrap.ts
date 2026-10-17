import { getComposioAppByIdentifier } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { ConnectorModel } from '@/database/models/connector';
import type { ConnectorMetadata } from '@/database/schemas';
import { ConnectorSourceType, ConnectorStatus, ConnectorToolPermission } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { inferCrudType } from '@/libs/mcp/utils';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import { isWorkspaceNonOwner } from '../_helpers/assertWorkspaceRowManageable';
import { connectorProcedure } from './procedures';

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
    composio?: ConnectorMetadata['composio'];
    description?: string;
    identifier: string;
    name: string;
    sourceType: string;
  },
): Promise<{ connectorId: string; writable: boolean }> {
  const metadata: ConnectorMetadata = {};
  if (params.description) metadata.description = params.description;
  if (params.avatar) metadata.avatar = params.avatar;
  if (params.composio) metadata.composio = params.composio;

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
      // Preserve runtime-owned metadata (especially Composio account identity)
      // while refreshing display fields from the latest plugin manifest.
      await ctx.connectorModel.update(row.id, { metadata: { ...row.metadata, ...metadata } });
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

export const bootstrapProcedures = {
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
};
