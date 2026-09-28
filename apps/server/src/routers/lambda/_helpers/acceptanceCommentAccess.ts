import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';

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
 * active one).
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

  const isOwner = Boolean(userId) && userId === acceptance.userId;
  const member =
    !isOwner && userId && acceptance.workspaceId
      ? await new WorkspaceMemberModel(db, userId).getMember(acceptance.workspaceId, userId)
      : undefined;

  const canRead = isOwner || acceptance.visibility === 'public' || Boolean(member);
  if (!canRead) throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });

  const canApprove = isOwner || (Boolean(member) && member!.role !== 'viewer');

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
