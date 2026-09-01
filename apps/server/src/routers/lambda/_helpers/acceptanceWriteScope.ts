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
