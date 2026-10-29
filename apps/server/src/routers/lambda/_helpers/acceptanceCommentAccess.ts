import { isWorkspaceReadableVisibility } from '@lobechat/const/verify';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import {
  findProjectReviewScope,
  resolveProjectReviewRole,
} from '@/server/services/acceptanceReview/projectAccess';

export interface AcceptanceCommentAccess {
  acceptance: AcceptanceItem;
  /**
   * May speak for the delivery itself — approve a round, post the round's own
   * introduction, sign as one of the workspace's agents, close someone else's
   * thread, or remove a remark that does not belong here. The creator, or a
   * non-viewer member of the acceptance's workspace.
   */
  canApprove: boolean;
  /** May write comments, annotations and reactions. */
  canComment: boolean;
  isOwner: boolean;
  /** The workspace whose agents this caller may sign as — only their own. */
  memberOfWorkspaceId?: string;
}

/**
 * Who may take part in an acceptance's discussion.
 *
 * Reading follows the bundle: the creator, anyone when the acceptance is
 * `public`, or a member of the acceptance's OWN workspace (not the caller's
 * active one). An `owner` acceptance is the creator's alone: membership and
 * project roles open nothing.
 *
 * Remarking is as wide as READING A PUBLIC LINK, minus anonymity — whoever was
 * handed the link can answer the evidence in front of them, and a shared
 * delivery nobody outside the team may reply to is a report, not a review. It
 * is NOT as wide as reading in general: a `viewer` of the acceptance's own
 * workspace stays read-only on a private delivery, the same role rule topic and
 * document comments enforce. Opening the link is the owner's decision to be
 * answered; being given read-only access to an org's internal work is not.
 *
 * Speaking FOR the delivery stays narrow. An approval and a round introduction
 * are the delivery's own voice, so they need the creator or a workspace
 * teammate; the acceptance decision itself is narrower still and lives on the
 * bundle's `canReview`.
 *
 * Missing access reads as NOT_FOUND, like the bundle, so existence never leaks.
 */
export async function resolveAcceptanceCommentAccess(
  db: LobeChatDatabase,
  userId: string | null | undefined,
  acceptanceId: string,
): Promise<AcceptanceCommentAccess> {
  const [acceptance] = isUuid(acceptanceId)
    ? await db.select().from(acceptances).where(eq(acceptances.id, acceptanceId)).limit(1)
    : [];
  if (!acceptance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  if (acceptance.subjectType === 'site') return resolveSiteReviewAccess(db, userId, acceptance);

  const isOwner = Boolean(userId) && userId === acceptance.userId;
  if (!isOwner && !isWorkspaceReadableVisibility(acceptance.visibility))
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  const member =
    !isOwner && userId && acceptance.workspaceId
      ? await new WorkspaceMemberModel(db, userId).getMember(acceptance.workspaceId, userId)
      : undefined;

  const project =
    !isOwner && userId && acceptance.projectId
      ? await findProjectReviewScope(db, acceptance.projectId)
      : null;
  const projectRole = project ? await resolveProjectReviewRole(db, userId, project) : null;

  const canRead =
    isOwner || acceptance.visibility === 'public' || Boolean(member) || Boolean(projectRole);
  if (!canRead) throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });

  const canApprove =
    isOwner ||
    (project
      ? projectRole === 'admin' || projectRole === 'member'
      : Boolean(member) && member!.role !== 'viewer');

  return {
    acceptance,
    canApprove,
    canComment: Boolean(userId) && (canApprove || acceptance.visibility === 'public'),
    isOwner,
    /*
     * Membership of the acceptance's workspace is what earns the right to speak
     * as one of its agents — the creator counts, they filed it there. The
     * acceptance being public does not: that hands out read access, and the
     * agent ids ride along in the discussion payload, so a visitor could read
     * one off the page and post under that agent's name and face.
     */
    memberOfWorkspaceId: isOwner || member ? (acceptance.workspaceId ?? undefined) : undefined,
  };
}

// A site review belongs to the project, not to whoever created it or to its visibility flag:
// only the project's current roles open it, so removing someone takes effect on their next request.
async function resolveSiteReviewAccess(
  db: LobeChatDatabase,
  userId: string | null | undefined,
  acceptance: AcceptanceItem,
): Promise<AcceptanceCommentAccess> {
  const project = acceptance.projectId
    ? await findProjectReviewScope(db, acceptance.projectId)
    : null;
  const role = project ? await resolveProjectReviewRole(db, userId, project) : null;
  if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });

  const canApprove = role === 'admin';
  return {
    acceptance,
    canApprove,
    canComment: role !== 'viewer',
    isOwner: project?.userId === userId,
    memberOfWorkspaceId: project?.workspaceId ?? undefined,
  };
}
