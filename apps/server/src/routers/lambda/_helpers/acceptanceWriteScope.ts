import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

export interface AcceptanceScopeCtx {
  serverDB: LobeChatDatabase;
  userId?: string | null;
}

/**
 * May this caller write to this acceptance?
 *
 * The creator always may. Beyond that, an acceptance that belongs to a workspace
 * may also be managed by an OWNER of **that** workspace — not of the caller's
 * currently-active one, which is frequently a different workspace or none at
 * all. Reading membership off the row's own workspace is what makes the rule
 * stable no matter where the caller happens to be standing, and it is the same
 * rule `getBundle` reports as `canReview`, so the page can never advertise an
 * action the mutation would refuse.
 */
export async function canManageAcceptance(
  ctx: AcceptanceScopeCtx,
  acceptance: Pick<AcceptanceItem, 'userId' | 'workspaceId'>,
): Promise<boolean> {
  if (ctx.userId && ctx.userId === acceptance.userId) return true;
  if (!ctx.userId || !acceptance.workspaceId) return false;

  const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
    acceptance.workspaceId,
    ctx.userId,
  );
  return member?.role === 'owner';
}

/**
 * Batch twin of {@link canManageAcceptance} for sweep endpoints: same rule,
 * but ONE membership lookup per distinct workspace instead of one per row —
 * a 200-row sweep must not turn authorization into 200 serial queries.
 */
export async function filterManageableAcceptances<
  T extends Pick<AcceptanceItem, 'userId' | 'workspaceId'>,
>(ctx: AcceptanceScopeCtx, rows: T[]): Promise<T[]> {
  if (!ctx.userId) return [];
  const userId = ctx.userId;

  const foreignWorkspaceIds = [
    ...new Set(
      rows
        .filter((row) => row.userId !== userId && row.workspaceId)
        .map((row) => row.workspaceId as string),
    ),
  ];
  const owned = new Set<string>();
  for (const workspaceId of foreignWorkspaceIds) {
    const member = await new WorkspaceMemberModel(ctx.serverDB, userId).getMember(
      workspaceId,
      userId,
    );
    if (member?.role === 'owner') owned.add(workspaceId);
  }

  return rows.filter(
    (row) => row.userId === userId || (row.workspaceId ? owned.has(row.workspaceId) : false),
  );
}
