import { TRPCError } from '@trpc/server';

import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { resolveAcceptanceCommentAccess } from '@/server/routers/lambda/_helpers/acceptanceCommentAccess';
import { canManageAcceptance } from '@/server/routers/lambda/_helpers/acceptanceWriteScope';

export interface ReviewAccess {
  acceptance: AcceptanceItem;
  can: { comment: boolean; decide: boolean; moderate: boolean };
}

export async function resolveReviewAccess(
  db: LobeChatDatabase,
  userId: string,
  acceptanceId: string,
): Promise<ReviewAccess | null> {
  try {
    const access = await resolveAcceptanceCommentAccess(db, userId, acceptanceId);
    const decide = await canManageAcceptance({ serverDB: db, userId }, access.acceptance);
    return {
      acceptance: access.acceptance,
      can: { comment: access.canComment, decide, moderate: access.canApprove },
    };
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}
