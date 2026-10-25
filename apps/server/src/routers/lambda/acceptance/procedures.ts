import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import { publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AcceptanceService } from '@/server/services/verify';

import { canManageAcceptance } from '../_helpers/acceptanceWriteScope';

export const ACCEPTANCE_DECISION_FORBIDDEN =
  'Only the creator or a workspace member with edit access can change this acceptance';

/** Reads addressed purely by acceptance id — visibility is checked in the handler. */
export const publicAcceptanceProcedure = publicProcedure.use(serverDatabase);

export const acceptanceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      acceptanceService: new AcceptanceService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

// Writes: workspace mode requires at least the member role (viewers are
// read-only); personal mode passes through unrestricted.
export const acceptanceWriteProcedure = acceptanceProcedure.use(
  requireWorkspaceRoleWhenScoped('member'),
);

/**
 * Resolve an acceptance for WRITING, with a service bound to the scope the row
 * actually lives in.
 *
 * Every model write is scoped by `buildWorkspaceWhere`, and `acceptances`
 * carries a `visibility` column — so that predicate narrows PRIVATE rows to
 * `userId = <bound user>`, and workspace acceptances default to private. A
 * service bound to the caller therefore cannot resolve a teammate's row at all,
 * and the write dies as `NOT_FOUND` after authorization already said yes.
 *
 * So the service is bound to the row's OWNER — the one binding that resolves it
 * — while the acting user is carried separately, because decisions record
 * `decidedBy` and an audit trail that credits a teammate's verdict to the
 * author is worse than one nobody can sign.
 */
export const resolveAcceptanceForWrite = async (
  ctx: { serverDB: LobeChatDatabase; userId: string },
  id: string,
): Promise<{ acceptance: AcceptanceItem; service: AcceptanceService }> => {
  const acceptance = isUuid(id)
    ? await ctx.serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, id) })
    : undefined;

  if (!acceptance) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  }

  if (!(await canManageAcceptance(ctx, acceptance))) {
    // A caller who cannot even read it gets the same answer as a missing row:
    // the existence of someone else's delivery is not ours to disclose. A
    // teammate already looking at it, though, is told why — "not found" about
    // a page they have open reads as a broken link, not as a missing right.
    if (!(await canReadAcceptance(ctx, acceptance))) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
    }
    throw new TRPCError({ code: 'FORBIDDEN', message: ACCEPTANCE_DECISION_FORBIDDEN });
  }

  return {
    acceptance,
    service: new AcceptanceService(
      ctx.serverDB,
      acceptance.userId,
      acceptance.workspaceId ?? undefined,
      { actorUserId: ctx.userId },
    ),
  };
};

/**
 * Resolve an acceptance for a REJECT, which reaches one step further than
 * {@link resolveAcceptanceForWrite}: besides everyone who may manage it, a
 * reader a decider granted reject access to may send it back.
 *
 * `delegated` marks that second case. The acting user is still the one whose
 * decision is recorded, but the repair belongs to the owner — the agent that
 * wrote the delivery, in the owner's conversation — so the caller dispatches it
 * as the owner rather than as a visitor who can reach neither.
 */
export const resolveAcceptanceForReject = async (
  ctx: { serverDB: LobeChatDatabase; userId: string },
  id: string,
): Promise<{ acceptance: AcceptanceItem; delegated: boolean; service: AcceptanceService }> => {
  try {
    return { ...(await resolveAcceptanceForWrite(ctx, id)), delegated: false };
  } catch (error) {
    // FORBIDDEN is only raised for a caller who can read the row; anything
    // else (missing, unreadable) stays the answer it was.
    if (!(error instanceof TRPCError) || error.code !== 'FORBIDDEN') throw error;
    const acceptance = await ctx.serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, id),
    });
    const granted =
      acceptance &&
      (await new AcceptanceCommentModel(ctx.serverDB).hasAccessGrant(
        acceptance.id,
        ctx.userId,
        'collaborate',
      ));
    if (!acceptance || !granted) throw error;
    return {
      acceptance,
      delegated: true,
      service: new AcceptanceService(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
        { actorUserId: ctx.userId },
      ),
    };
  }
};

export const canReadAcceptance = async (
  ctx: { serverDB: LobeChatDatabase; userId?: string | null },
  acceptance: AcceptanceItem,
) => {
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
