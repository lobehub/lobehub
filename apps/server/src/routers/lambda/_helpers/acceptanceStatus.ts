import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { notifyAcceptance } from '@/server/services/acceptanceReview/events';
import { GoalBriefService } from '@/server/services/goal/goalBriefs';
import type { AcceptanceService } from '@/server/services/verify/acceptanceService';

import { assertNotHoldingRelease } from './goalGateAcceptance';

export const acceptanceStatusOverrideSchema = z.enum([
  'delivered',
  'accepted',
  'closed',
  'rejected',
]);

/**
 * A decided acceptance has nothing left to sign: whichever control decided it,
 * the inbox and the island stop asking for the goal sign-off it carried.
 */
export const settleGoalSignOff = (
  db: LobeChatDatabase,
  acceptance: AcceptanceItem,
  action: string,
  comment?: string,
) =>
  new GoalBriefService(db, acceptance.userId, acceptance.workspaceId ?? undefined).settleSignOff(
    acceptance.id,
    action,
    comment,
  );

/**
 * Apply one user-facing lifecycle override to an already-resolved,
 * already-authorized aggregate. Shared by the single-row menu action and the
 * list's multi-select sweep, so both obey exactly the same transition rules.
 *
 * accept / reject go through the SERVICE, never a bare status write: the
 * service applies `requireDecidableAcceptance` (a premature `accepted` is
 * sticky in recomputeStatus and could never be corrected by a later verifier
 * result) and stamps the decision on the current round. Reopen is only
 * meaningful for an already-decided aggregate — a still-running round must
 * not be forced back to a decision-pending state by hand.
 */
export const applyAcceptanceStatus = async (
  db: LobeChatDatabase,
  service: AcceptanceService,
  acceptance: AcceptanceItem,
  status: z.infer<typeof acceptanceStatusOverrideSchema>,
) => {
  await assertNotHoldingRelease(db, acceptance);
  if (status === 'accepted') {
    await service.accept(acceptance.id);
    await settleGoalSignOff(db, acceptance, 'signOff');
    return;
  }

  if (status === 'closed') {
    await service.acceptanceModel.updateStatus(acceptance.id, 'closed');
    notifyAcceptance(acceptance.id, 'session');
    await settleGoalSignOff(db, acceptance, 'closed');
    return;
  }

  if (status === 'rejected') {
    await service.reject(acceptance.id, 'Rejected from the acceptance list — needs another round.');
    await settleGoalSignOff(db, acceptance, 'requestChanges');
    return;
  }

  // Reopen (→ delivered): only a decided aggregate can be re-opened; a live
  // round recomputes its own status and must not be clobbered.
  if (
    acceptance.status !== 'accepted' &&
    acceptance.status !== 'closed' &&
    acceptance.status !== 'rejected'
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Only a decided acceptance can be reopened (status: ${acceptance.status})`,
    });
  }

  await service.acceptanceModel.updateStatus(acceptance.id, 'delivered');
  notifyAcceptance(acceptance.id, 'session');
};
