import { TRPCError } from '@trpc/server';

import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { resolveAcceptanceCommentAccess } from '@/server/routers/lambda/_helpers/acceptanceCommentAccess';
import { canManageAcceptance } from '@/server/routers/lambda/_helpers/acceptanceWriteScope';

export interface ReviewAccess {
  acceptance: AcceptanceItem;
  can: { comment: boolean; decide: boolean; moderate: boolean; reject: boolean };
}

export async function resolveReviewAccess(
  db: LobeChatDatabase,
  userId: string,
  acceptanceId: string,
): Promise<ReviewAccess | null> {
  try {
    const access = await resolveAcceptanceCommentAccess(db, userId, acceptanceId);
    const decide = await canManageAcceptance({ serverDB: db, userId }, access.acceptance);
    // Granted reject access sends the delivery back; accepting stays a decider's.
    const reject =
      access.acceptance.subjectType !== 'site' &&
      (decide ||
        (await new AcceptanceCommentModel(db).hasAccessGrant(
          access.acceptance.id,
          userId,
          'collaborate',
        )));
    return {
      acceptance: access.acceptance,
      can: { comment: access.canComment, decide, moderate: access.canApprove, reject },
    };
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}
