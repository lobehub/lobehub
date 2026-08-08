import { TRPCError } from '@trpc/server';

interface WorkspaceRowCtx {
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: string;
}

export type WorkspaceBulkDeleteScope = 'own' | 'workspace';

/**
 * Row-level creator check for workspace-shared resources (connectors, skills,
 * installed plugins). `buildWorkspaceWhere` makes these rows visible/writable
 * workspace-wide, so procedure-level role gates alone let any member mutate
 * rows created by someone else. This assert restores the `:owner`-scope
 * semantics of the role-permission matrix: a member may only mutate rows they
 * created; workspace owners may manage every row.
 *
 * - Personal mode (no `workspaceId`): pass through — the model's ownership
 *   filter already scopes rows to the caller.
 * - Workspace owner: pass through — owners manage all workspace resources.
 * - Otherwise the row's creator must be the caller.
 */
export function assertWorkspaceRowManageable(
  ctx: WorkspaceRowCtx,
  rowUserId: string | null | undefined,
  resource: string,
): void {
  if (!ctx.workspaceId) return;
  if (ctx.workspaceRole === 'owner') return;
  if (rowUserId !== ctx.userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Only the creator or a workspace owner can modify this ${resource}`,
    });
  }
}

/**
 * Whether the caller operates in a workspace without owner privileges — used
 * to restrict bulk/sweep mutations to rows the caller created. Reads
 * `workspaceRole` through the optional ctx field because the OSS
 * `withScopedPermission` stub does not inject it (cloud's override does).
 */
export function isWorkspaceNonOwner(
  ctx: Pick<WorkspaceRowCtx, 'workspaceId' | 'workspaceRole'>,
): boolean {
  return !!ctx.workspaceId && ctx.workspaceRole !== 'owner';
}

/**
 * Resolve whether a bulk delete must be restricted to the caller's rows.
 * Caller scope is always the safe default, including for workspace owners.
 * Workspace-wide scope is an explicit owner-only capability.
 */
export function shouldRestrictBulkDeleteToCreator(
  ctx: Pick<WorkspaceRowCtx, 'workspaceId' | 'workspaceRole'>,
  scope: WorkspaceBulkDeleteScope,
): boolean {
  if (scope === 'own') return true;
  if (ctx.workspaceId && ctx.workspaceRole === 'owner') return false;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only a workspace owner can delete topics created by all workspace members',
  });
}
