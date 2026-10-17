import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { resolveAcceptanceCommentAccess } from './acceptanceCommentAccess';

export const canReadAcceptance = async (
  ctx: { serverDB: LobeChatDatabase; userId?: string | null },
  acceptance: AcceptanceItem,
) => {
  if (acceptance.subjectType === 'site') {
    return resolveAcceptanceCommentAccess(ctx.serverDB, ctx.userId, acceptance.id).then(
      () => true,
      () => false,
    );
  }
  if (ctx.userId && ctx.userId === acceptance.userId) return true;
  if (acceptance.visibility === 'public') return true;
  if (!ctx.userId || !acceptance.workspaceId) return false;
  // Membership in the acceptance's OWN workspace — not the viewer's currently
  // active one, which may be a different workspace entirely.
  const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
    acceptance.workspaceId,
    ctx.userId,
  );
  return Boolean(member);
};
