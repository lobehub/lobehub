import type { WorkspaceConnectorMemberManage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import { assertWorkspaceRowManageable } from './assertWorkspaceRowManageable';

interface ConnectorManageCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: string;
}

/** The connector row being changed; omit when the write would create a new one. */
interface ConnectorRowRef {
  agentId?: string | null;
  userId?: string | null;
}

export const isWorkspaceConnectorAdmin = (
  ctx: Pick<ConnectorManageCtx, 'workspaceId' | 'workspaceRole'>,
) => ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin';

export const getConnectorMemberManage = (
  ctx: ConnectorManageCtx,
): Promise<WorkspaceConnectorMemberManage> => {
  if (!ctx.workspaceId) return Promise.resolve('all_members');
  return new WorkspaceModel(ctx.serverDB, ctx.userId).getConnectorMemberManage(ctx.workspaceId);
};

/**
 * Whether the caller may maintain the workspace's shared connectors: owners and
 * admins always may, viewers never, and members unless an admin restricted it
 * to `admins_only`. Personal mode always passes.
 */
export const canManageWorkspaceConnectors = async (ctx: ConnectorManageCtx): Promise<boolean> => {
  if (!ctx.workspaceId) return true;
  if (isWorkspaceConnectorAdmin(ctx)) return true;
  if (ctx.workspaceRole === 'viewer') return false;
  return (await getConnectorMemberManage(ctx)) === 'all_members';
};

const forbidden = () =>
  new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only workspace owners and admins can change connectors in this workspace',
  });

/**
 * Gate a maintenance write (connect, re-authorize, edit, sync, remove) on a
 * workspace connector by the workspace's member policy. Shared rows are
 * co-maintained, so the creator does not matter here; agent-scoped rows belong
 * to their agent's setup and keep the creator-or-owner rule.
 */
export const assertConnectorMaintainable = async (
  ctx: ConnectorManageCtx,
  row?: ConnectorRowRef,
): Promise<void> => {
  if (!ctx.workspaceId) return;
  if (row?.agentId) {
    // A new agent row is gated by the caller's edit rights on that agent.
    if (row.userId) assertWorkspaceRowManageable(ctx, row.userId, 'connector');
    return;
  }
  if (!(await canManageWorkspaceConnectors(ctx))) throw forbidden();
};

/**
 * Gate a write that hands a connector's stored credentials to someone else's
 * control (edit-form prefill, binding/copying/mounting it onto an agent). On top
 * of the member policy, only the creator or a workspace owner may do it, since
 * co-maintaining a connector does not mean reading another member's secrets.
 */
export const assertConnectorCredentialsManageable = async (
  ctx: ConnectorManageCtx,
  row: ConnectorRowRef,
): Promise<void> => {
  if (!ctx.workspaceId) return;
  if (!row.agentId && !(await canManageWorkspaceConnectors(ctx))) throw forbidden();
  assertWorkspaceRowManageable(ctx, row.userId, 'connector');
};
