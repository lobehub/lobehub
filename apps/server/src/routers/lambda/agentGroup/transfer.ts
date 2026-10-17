import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { startAgentTransferJob } from '@/business/server/agent-transfer/jobRunner';
import { notifyResourceTransfer } from '@/business/server/resource-transfer/notify';
import { AGENT_SHARED_TRANSFER_BLOCKED } from '@/database/models/agent';
import { AGENT_COPY_IN_PROGRESS } from '@/database/models/agentCopyJob';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AgentTransferJobModel,
} from '@/database/models/agentTransferJob';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import {
  ResourceTransferRequestModel,
  TRANSFER_REQUEST_ALREADY_PENDING,
} from '@/database/models/resourceTransferRequest';
import { TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS } from '@/database/models/topicComment';
import { GROUP_HAS_INACCESSIBLE_MEMBER } from '@/database/repositories/agentGroup';
import {
  DEFAULT_RESOURCE_ACCESS_LEVELS,
  LEGACY_VIEWER_ACCESS_LEVELS,
  RESOURCE_ACCESS_LEVELS_BY_TYPE,
} from '@/database/schemas';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { assertTransferRecipientValid } from '@/server/services/resourceTransferRequest';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';
import { after } from '@/server/utils/scheduleAfterResponse';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from '../_helpers/assertWorkspaceRowManageable';
import { agentGroupProcedure, agentGroupProcedureWrite } from './procedures';
import { applyGroupAccessLevel } from './visibility';

export const transferProcedures = {
  transferGroup: agentGroupProcedureWrite
    .input(
      z.object({
        groupId: z.string(),
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agentGroup).optional(),
        /** @deprecated Compatibility for released clients. */
        targetGeneralAccess: z.enum(['editor', 'viewer']).optional(),
        /**
         * Hand ownership to another member of the CURRENT workspace. Mutually
         * exclusive with `targetWorkspaceId`; creates a pending transfer
         * request the recipient must accept instead of moving anything now.
         */
        targetMemberId: z.string().min(1).optional(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const group = await ctx.chatGroupModel.findById(input.groupId);
      if (!group) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent group not found',
        });
      }

      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      // Member transfer: initiate a pending request instead of moving the
      // group. Nothing changes until the recipient accepts.
      if (input.targetMemberId) {
        if (!ctx.workspaceId || input.targetWorkspaceId) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferNotSupported } },
            code: 'BAD_REQUEST',
            message: 'Member transfer happens inside the current workspace',
          });
        }
        await assertTransferRecipientValid({
          currentOwnerId: group.userId,
          db: ctx.serverDB,
          initiatorId: ctx.userId,
          recipientId: input.targetMemberId,
          workspaceId: ctx.workspaceId,
        });

        try {
          const request = await new ResourceTransferRequestModel(
            ctx.serverDB,
            ctx.workspaceId,
          ).create({
            initiatorId: ctx.userId,
            previousOwnerId: group.userId,
            recipientId: input.targetMemberId,
            resourceId: input.groupId,
            resourceType: 'agentGroup',
          });
          // Best-effort: a notification failure must not fail the request.
          // Scheduled with after() so serverless runtimes keep it alive past
          // the response.
          const notifyParams = {
            event: 'requested' as const,
            initiatorId: ctx.userId,
            previousOwnerId: group.userId,
            recipientId: input.targetMemberId,
            requestId: request.id,
            resourceId: input.groupId,
            resourceType: 'agentGroup' as const,
            workspaceId: ctx.workspaceId,
          };
          after(() =>
            notifyResourceTransfer(notifyParams).catch((error) =>
              console.error('[agentGroup:transferGroup] notify failed', error),
            ),
          );
          return { requestId: request.id, status: 'pending' as const };
        } catch (error) {
          if (error instanceof Error && error.message === TRANSFER_REQUEST_ALREADY_PENDING) {
            throw new TRPCError({
              cause: { data: { code: TransferErrorCode.TransferRequestPending } },
              code: 'CONFLICT',
              message: 'This group already has a pending transfer request',
            });
          }
          throw error;
        }
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });

        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent group to the same workspace',
        });
      }

      // The transfer rehomes member agents and every group conversation — only
      // the primary owner may move teammates' rows along with a group;
      // co-admins and members may not.
      if (
        ctx.workspaceId &&
        !(await isWorkspacePrimaryOwner({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })) &&
        (await ctx.agentGroupRepo.transferHasForeignRows(input.groupId))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only the workspace owner can transfer a group carrying others' content",
        });
      }

      let result;
      try {
        result = await ctx.agentGroupRepo.transferToWorkspace(
          input.groupId,
          input.targetWorkspaceId,
          ctx.userId,
          input.targetVisibility,
          { rejectForeignTopicCommentAuthors: isWorkspaceNonOwner(ctx) },
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can transfer a group carrying others' content",
          });
        }
        if (error instanceof Error && error.message === GROUP_HAS_INACCESSIBLE_MEMBER) {
          throw new TRPCError({
            // No group or member id in the payload: which member is hidden is
            // exactly what the caller is not entitled to learn.
            cause: { data: { code: TransferErrorCode.GroupHasInaccessibleMember } },
            code: 'FORBIDDEN',
            message: 'This group includes a member you do not have access to',
          });
        }
        if (error instanceof Error && error.message === AGENT_COPY_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.CopyInProgress } },
            code: 'CONFLICT',
            message: 'A previous copy of this agent is still duplicating its history',
          });
        }
        if (error instanceof Error && error.message === AGENT_TRANSFER_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferInProgress } },
            code: 'CONFLICT',
            message: "A previous transfer of this group's agents is still migrating history",
          });
        }
        if (error instanceof Error && error.message === AGENT_SHARED_TRANSFER_BLOCKED) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.SharedTransferBlocked } },
            code: 'PRECONDITION_FAILED',
            message: 'This group contains a shared agent, so its ownership cannot be changed.',
          });
        }
        throw error;
      }

      // Nothing moved: the group was not in this scope, or a racing transfer
      // took it before we got the row lock. Return before the permission writes
      // below — they would wipe the source ACL and grant access in the target
      // for a group this call did not transfer.
      if (!result) return result;

      // Heavy history goes through an async backfill — kick the driver now
      // that the transfer transaction has committed.
      if (result.transferJobId) startAgentTransferJob(ctx.serverDB, result.transferJobId);

      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agentGroup',
          input.groupId,
        );
        // The group left this workspace — a pending member transfer request
        // for it can never complete here, so void it.
        await new ResourceTransferRequestModel(
          ctx.serverDB,
          ctx.workspaceId,
        ).invalidateForResources('agentGroup', [input.groupId]);
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        // A released client's two-valued `viewer` is an explicit "less than
        // editor" choice, so it resolves through the legacy map rather than the
        // default (which is `edit`); saying nothing at all still means "what a
        // newly created group would get".
        const targetAccessLevel =
          input.targetAccessLevel ??
          (input.targetGeneralAccess
            ? input.targetGeneralAccess === 'editor'
              ? 'edit'
              : LEGACY_VIEWER_ACCESS_LEVELS.agentGroup
            : DEFAULT_RESOURCE_ACCESS_LEVELS.agentGroup);
        // `transferToWorkspace` makes the moved supervisor / generated members
        // public in the target too, so they need the same cascade as the
        // publish paths — otherwise their own ACL falls back to the agent
        // default (`edit`) and target members can edit the owned agents of a
        // use/view-only group.
        await applyGroupAccessLevel({
          accessLevel: targetAccessLevel,
          ctx,
          groupId: input.groupId,
          permissionModel: new ResourcePermissionModel(ctx.serverDB, input.targetWorkspaceId),
          workspaceId: input.targetWorkspaceId,
        });
      }

      return result;
    }),
  /**
   * Check agents before removal to identify virtual agents that will be permanently deleted.
   * This allows the frontend to show a confirmation dialog.
   */
  /**
   * Progress of the async history backfill after a heavy group transfer/copy,
   * plus the topic ids still awaiting their turn (the UI's gray-out set).
   * Returns null when no backfill is running for the group.
   *
   * The group twin of `agent.getTransferJobStatus`. Only the lookup key
   * differs: a group's job is found through the group junction, not the member
   * agents — a group with an empty roster registers no agent rows at all.
   * Queue-jumping stays on `agent.prioritizeTransferTopic`, which is keyed by
   * topic and authorizes by topic visibility, so it already serves both.
   */
  getTransferJobStatus: agentGroupProcedure
    .input(
      z.object({
        groupId: z.string(),
        /**
         * Topics the client currently shows (sidebar rows + active topic).
         * `pendingTopicIds` is the intersection with the job's queue, keeping
         * the poll payload bounded however large the backfill is.
         */
        topicIds: z.array(z.string()).max(1000),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Scope check: only report migration state for groups visible to the
      // caller's current personal/workspace scope (group ids are guessable).
      const group = await ctx.chatGroupModel.findById(input.groupId);
      if (!group) return null;

      const job = await AgentTransferJobModel.findPendingJobForGroup(ctx.serverDB, input.groupId);
      if (!job) return null;
      const pendingTopicIds = await AgentTransferJobModel.getPendingTopicIds(
        ctx.serverDB,
        job.id,
        input.topicIds,
      );
      return {
        completedTopics: job.completedTopics,
        jobId: job.id,
        pendingTopicIds,
        totalTopics: job.totalTopics,
        // `transfer` vs `copy` — the client words its progress hints by it.
        type: job.type,
      };
    }),
};
