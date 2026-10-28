import { isWorkspaceReadableVisibility } from '@lobechat/const/verify';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import {
  findProjectReviewScope,
  resolveProjectReviewRole,
} from '@/server/services/acceptanceReview/projectAccess';

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
  if (!ctx.userId || !isWorkspaceReadableVisibility(acceptance.visibility)) return false;
  // Membership in the acceptance's OWN workspace — not the viewer's currently
  // active one, which may be a different workspace entirely.
  if (acceptance.workspaceId) {
    const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
      acceptance.workspaceId,
      ctx.userId,
    );
    if (member) return true;
  }
  // A project role opens the delivery too, exactly as it opens its discussion in
  // `resolveAcceptanceCommentAccess`; otherwise comments would load on a page that 404s.
  if (!acceptance.projectId) return false;
  const project = await findProjectReviewScope(ctx.serverDB, acceptance.projectId);
  return Boolean(project && (await resolveProjectReviewRole(ctx.serverDB, ctx.userId, project)));
};
