import { TRPCError } from '@trpc/server';

import type { ConnectorModel } from '@/database/models/connector';
import type { ConnectorMetadata } from '@/database/schemas';
import { ConnectorStatus } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import { isWorkspaceNonOwner } from './assertWorkspaceRowManageable';

/**
 * Create connector entry if not exists (or update metadata), return connectorId.
 *
 * These bootstrap syncs run whenever any member opens a shared skill's detail
 * panel, so an existing row created by someone else must not be rewritten by a
 * non-owner caller — the row is returned read-only (`writable: false`) and the
 * caller skips the tool upsert instead of throwing, keeping browsing intact.
 */
export async function upsertConnectorEntry(
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
