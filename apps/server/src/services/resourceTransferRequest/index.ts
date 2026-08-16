import type { TransferResourceType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { ResourceTransferRequestItem } from '@/database/schemas';
import { workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { TransferErrorCode } from '@/types/transferError';

/**
 * The resource-agnostic half of member-to-member ownership transfer: who may
 * receive one, and how an accepted request is executed. Initiation policy
 * (who may give a resource away) stays with `canPerformResourceAction`'s
 * `transfer` action; this module owns the recipient side and the per-type
 * accept executors.
 */

/** Resource types with a wired-up accept executor. Extend together with {@link executeAcceptedTransfer}. */
export const TRANSFERABLE_TO_MEMBER_RESOURCE_TYPES = [
  'agent',
  'agentGroup',
] as const satisfies readonly TransferResourceType[];

export const isMemberTransferSupported = (
  resourceType: TransferResourceType,
): resourceType is (typeof TRANSFERABLE_TO_MEMBER_RESOURCE_TYPES)[number] =>
  (TRANSFERABLE_TO_MEMBER_RESOURCE_TYPES as readonly TransferResourceType[]).includes(resourceType);

/**
 * The recipient of a transfer must be an ACTIVE member of the workspace and a
 * different person from both the initiator and the current owner. Shared by
 * every resource type's initiation endpoint.
 */
export const assertTransferRecipientValid = async (params: {
  currentOwnerId: string;
  db: LobeChatDatabase;
  initiatorId: string;
  recipientId: string;
  workspaceId: string;
}): Promise<void> => {
  const { currentOwnerId, db, initiatorId, recipientId, workspaceId } = params;

  if (recipientId === initiatorId || recipientId === currentOwnerId) {
    throw new TRPCError({
      cause: { data: { code: TransferErrorCode.TargetIsCurrentOwner } },
      code: 'BAD_REQUEST',
      message: 'The agent already belongs to this member',
    });
  }

  await assertRecipientCanOwn({ actorId: initiatorId, db, recipientId, workspaceId });
};

/**
 * The membership half of recipient validation: an ACTIVE member with write
 * capability. Checked when a request is created AND re-checked at accept time
 * — the seven-day pending window is long enough for the recipient to be
 * removed or downgraded to viewer in between.
 */
export const assertRecipientCanOwn = async (params: {
  /** Whose model instance runs the lookup (initiator at create, recipient at accept). */
  actorId: string;
  db: LobeChatDatabase;
  recipientId: string;
  workspaceId: string;
}): Promise<void> => {
  const { actorId, db, recipientId, workspaceId } = params;

  const member = await new WorkspaceMemberModel(db, actorId).getMember(workspaceId, recipientId);
  assertOwnableMemberRow(member);
};

/** The role half of recipient validation, shared by the create-time lookup and the accept-time lock. */
const assertOwnableMemberRow = (member: { role: string } | undefined): void => {
  if (!member) {
    throw new TRPCError({
      cause: { data: { code: TransferErrorCode.TargetNotWorkspaceMember } },
      code: 'BAD_REQUEST',
      message: 'The recipient is not an active member of this workspace',
    });
  }

  // Viewers hold no `agent:update` capability, so ownership handed to one
  // would strand the resource: they could neither edit it nor transfer it
  // back.
  if (member.role === 'viewer') {
    throw new TRPCError({
      cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
      code: 'BAD_REQUEST',
      message: 'The recipient cannot own resources in this workspace',
    });
  }
};

/**
 * Execute an accepted transfer: flip the request state and hand the resource
 * over, atomically. The request flip and the ownership rewrite share one
 * transaction so a raced/stale accept rolls both back.
 *
 * Session migration is only honored on the creator path — a primary owner
 * reassigning someone else's resource cannot give away conversations that are
 * not theirs (`previousOwnerId !== initiatorId` drops the option).
 */
export const executeAcceptedTransfer = async (params: {
  db: LobeChatDatabase;
  recipientId: string;
  request: ResourceTransferRequestItem;
  workspaceId: string;
}): Promise<{ transferJobId: string | null }> => {
  const { db, recipientId, request, workspaceId } = params;

  if (!isMemberTransferSupported(request.resourceType)) {
    throw new TRPCError({
      cause: { data: { code: TransferErrorCode.TransferNotSupported } },
      code: 'BAD_REQUEST',
      message: `Member transfer is not supported for ${request.resourceType} yet`,
    });
  }

  const requestModel = new ResourceTransferRequestModel(db, workspaceId);
  const migrateSessions =
    !!request.options?.migrateSessions &&
    !!request.previousOwnerId &&
    request.previousOwnerId === request.initiatorId;

  return db.transaction(async (trx: Transaction) => {
    // Re-validate at accept time, INSIDE the transaction with the membership
    // row locked: creation-time validation does not survive the pending
    // window, and a check outside the transaction could race a concurrent
    // removal/downgrade committing between the check and the handover.
    const [member] = await trx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, recipientId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .for('update');
    assertOwnableMemberRow(member);

    // A reassignment request (primary owner moving someone ELSE's resource)
    // borrowed the INITIATOR's authority at creation; that authority must
    // still hold now — workspace ownership can change and the resource can
    // turn private during the seven-day pending window. Creator-initiated
    // requests need no re-check: the per-type staleness guard already proves
    // the initiator still owns the resource.
    if (request.previousOwnerId !== request.initiatorId) {
      const staleAuthority = () =>
        new TRPCError({
          cause: { data: { code: TransferErrorCode.TransferRequestStale } },
          code: 'BAD_REQUEST',
          message: "The initiator's authority changed since this request was created",
        });
      if (!request.initiatorId) throw staleAuthority();
      try {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db,
          resourceId: request.resourceId,
          resourceType: request.resourceType,
          userId: request.initiatorId,
          workspaceId,
        });
      } catch {
        throw staleAuthority();
      }
    }

    await requestModel.accept(request.id, recipientId, trx);

    // A null previousOwnerId means the owner's account was deleted after the
    // request was created; the resource row's FK cascade removed it too, so
    // the per-type staleness check will reject with a precise error.
    const fromUserId = request.previousOwnerId ?? '';

    switch (request.resourceType) {
      case 'agentGroup': {
        const chatGroupModel = new ChatGroupModel(db, recipientId, workspaceId);
        await chatGroupModel.transferGroupOwnership(trx, {
          fromUserId,
          groupId: request.resourceId,
          toUserId: recipientId,
        });
        // Nothing moves scope on a group handover, so there is no backfill.
        return { transferJobId: null };
      }
      default: {
        const agentModel = new AgentModel(db, recipientId, workspaceId);
        return agentModel.transferAgentOwnership(trx, {
          agentId: request.resourceId,
          fromUserId,
          migrateSessions,
          toUserId: recipientId,
        });
      }
    }
  });
};
