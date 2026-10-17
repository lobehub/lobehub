import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  prioritizeAgentTransferTopic,
  startAgentTransferJob,
} from '@/business/server/agent-transfer/jobRunner';
import { notifyResourceTransfer } from '@/business/server/resource-transfer/notify';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { AGENT_SHARED_TRANSFER_BLOCKED, AgentOwnedByGroupError } from '@/database/models/agent';
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
import { TopicModel } from '@/database/models/topic';
import { TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS } from '@/database/models/topicComment';
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
import { agentProcedure } from './procedures';

export const transferProcedures = {
  /**
   * Progress of the async history backfill after a heavy transfer, plus the
   * topic ids still awaiting their scope rewrite (the UI's gray-out set).
   * Returns null when no backfill is running for the agent.
   */
  getTransferJobStatus: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        /**
         * Topics the client currently shows (sidebar rows + active topic).
         * `pendingTopicIds` is the intersection with the job's queue, keeping
         * the 3s poll payload bounded however large the backfill is. Required
         * so no caller can pull the whole queue (this endpoint ships with the
         * clients that send it — there is no released-client compat to keep).
         */
        topicIds: z.array(z.string()).max(1000),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Scope check: only report migration state for agents visible to the
      // caller's current personal/workspace scope (agent ids are guessable).
      const visibility = await ctx.agentModel.getAgentVisibility(input.agentId);
      if (!visibility) return null;

      const job = await AgentTransferJobModel.findPendingJobForAgent(ctx.serverDB, input.agentId);
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
  /**
   * What moving these agents would do to the chat groups they are in.
   *
   * Asked before the move, because both outcomes are invisible otherwise: a
   * transfer drops every group link the agent holds — historically without a
   * word — and a group-owned agent cannot be moved at all. The mutation
   * enforces the second case regardless; this endpoint exists so the user
   * learns about it while they can still choose differently.
   */
  getGroupMembershipImpact: agentProcedure
    .input(z.object({ agentIds: z.array(z.string()).min(1).max(100) }))
    .query(async ({ input, ctx }) =>
      // Reports only on agents the caller can see — the model does that scoping
      // itself, because the guard path deliberately does not.
      ctx.agentModel.getGroupMembershipImpact(input.agentIds),
    ),
  /**
   * The user opened a topic whose history is still migrating — jump it to the
   * front of the backfill queue. Returns whether the topic was still pending
   * (false → already migrated, the client can refetch messages immediately).
   */
  prioritizeTransferTopic: agentProcedure
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Scope check: reordering the backfill queue is only allowed for topics
      // the caller can see (the transfer moves topics to the target scope
      // synchronously, so a pending topic is visible to its new owner).
      const topic = await new TopicModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).findById(input.topicId);
      if (!topic) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
      }

      const flagged = await prioritizeAgentTransferTopic(ctx.serverDB, input.topicId);
      return { pending: flagged };
    }),
  transferAgent: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        /**
         * Cross-workspace move only: the General Access level the agent gets
         * in the target workspace. Ignored on a member transfer (`targetMemberId`),
         * which keeps the agent's existing ACL in place.
         */
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
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
      // 1. Fetch the agent to check ownership
      const agent = await ctx.agentModel.getAgentConfigById(input.agentId);
      if (!agent) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      // 2. Transferring ownership/scope is always creator-only.
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      // 2a. Member transfer: initiate a pending request instead of moving the
      // agent. Nothing changes until the recipient accepts.
      if (input.targetMemberId) {
        if (!ctx.workspaceId || input.targetWorkspaceId) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferNotSupported } },
            code: 'BAD_REQUEST',
            message: 'Member transfer happens inside the current workspace',
          });
        }
        // Group-built/virtual rows are workspace infrastructure, not content
        // someone can personally hand over.
        if (agent.virtual) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferNotSupported } },
            code: 'BAD_REQUEST',
            message: 'This agent cannot be transferred',
          });
        }
        await assertTransferRecipientValid({
          currentOwnerId: agent.userId,
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
            previousOwnerId: agent.userId,
            recipientId: input.targetMemberId,
            resourceId: input.agentId,
            resourceType: 'agent',
          });
          // Best-effort: a notification failure must not fail the request.
          // Scheduled with after() so serverless runtimes keep it alive past
          // the response.
          const notifyParams = {
            event: 'requested' as const,
            initiatorId: ctx.userId,
            previousOwnerId: agent.userId,
            recipientId: input.targetMemberId,
            requestId: request.id,
            resourceId: input.agentId,
            resourceType: 'agent' as const,
            workspaceId: ctx.workspaceId,
          };
          after(() =>
            notifyResourceTransfer(notifyParams).catch((error) =>
              console.error('[agent:transferAgent] notify failed', error),
            ),
          );
          return { requestId: request.id, status: 'pending' as const };
        } catch (error) {
          if (error instanceof Error && error.message === TRANSFER_REQUEST_ALREADY_PENDING) {
            throw new TRPCError({
              cause: { data: { code: TransferErrorCode.TransferRequestPending } },
              code: 'CONFLICT',
              message: 'This agent already has a pending transfer request',
            });
          }
          throw error;
        }
      }

      // 3. Validate target workspace access (user must be member+)
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

      // 4. Cannot transfer to the same workspace
      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent to the same workspace',
        });
      }

      // 5. The transfer rehomes every linked topic/message/thread/task — only
      //    the primary owner may move teammates' conversations along with an
      //    agent; co-admins and members may not.
      if (
        ctx.workspaceId &&
        !(await isWorkspacePrimaryOwner({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })) &&
        (await ctx.agentModel.transferHasForeignRows(input.agentId))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only the workspace owner can transfer an agent carrying others' conversations",
        });
      }

      let result;
      try {
        result = await ctx.agentModel.transferAgent(
          input.agentId,
          input.targetWorkspaceId,
          ctx.userId,
          input.targetVisibility,
          {
            rejectForeignTopicCommentAuthors: isWorkspaceNonOwner(ctx),
          },
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can transfer an agent carrying others' conversations",
          });
        }
        if (error instanceof AgentOwnedByGroupError) {
          throw new TRPCError({
            // The group list travels with the code: "this agent belongs to a
            // group" is only actionable once the user knows which group.
            cause: { data: { code: TransferErrorCode.AgentOwnedByGroup, groups: error.groups } },
            code: 'CONFLICT',
            message: 'This agent belongs to a chat group and cannot be moved on its own',
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
            message: 'A previous transfer of this agent is still migrating its history',
          });
        }
        if (error instanceof Error && error.message === AGENT_SHARED_TRANSFER_BLOCKED) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.SharedTransferBlocked } },
            code: 'PRECONDITION_FAILED',
            message:
              'This agent cannot be transferred while a share link exists, including paused links.',
          });
        }
        throw error;
      }

      // Heavy history goes through an async backfill — kick the driver now
      // that the transfer transaction has committed.
      if (result.transferJobId) startAgentTransferJob(ctx.serverDB, result.transferJobId);

      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agent',
          input.agentId,
        );
        // The agent left this workspace — a live member-transfer request can
        // no longer be accepted, so void it.
        await new ResourceTransferRequestModel(
          ctx.serverDB,
          ctx.workspaceId,
        ).invalidateForResources('agent', [input.agentId]);
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        // A released client's two-valued `viewer` is an explicit "less than
        // editor" choice, so it resolves through the legacy map rather than the
        // default (which is `edit`); saying nothing at all still means "what a
        // newly created agent would get".
        const targetAccessLevel =
          input.targetAccessLevel ??
          (input.targetGeneralAccess
            ? input.targetGeneralAccess === 'editor'
              ? 'edit'
              : LEGACY_VIEWER_ACCESS_LEVELS.agent
            : DEFAULT_RESOURCE_ACCESS_LEVELS.agent);
        await new ResourcePermissionModel(ctx.serverDB, input.targetWorkspaceId).setAccessLevel(
          'agent',
          input.agentId,
          targetAccessLevel,
          ctx.userId,
        );
      }

      return result;
    }),
  /**
   * Batch variant of `transferAgent`: one request + one DB transaction for all
   * selected agents, so a multi-select "Move Agent" is no longer N serial
   * round-trips (each with its own permission checks and large-table updates).
   */
  transferAgents: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentIds: z.array(z.string()).min(1).max(100),
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const agentIds = [...new Set(input.agentIds)];

      // 1. All agents must exist in the current scope
      const existences = await Promise.all(
        agentIds.map((agentId) => ctx.agentModel.existsById(agentId)),
      );
      if (existences.some((exists) => !exists)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      // 2. Transferring ownership/scope is always creator-only.
      if (ctx.workspaceId) {
        await Promise.all(
          agentIds.map((agentId) =>
            assertCanPerformResourceAction({
              action: 'transfer',
              db: ctx.serverDB,
              resourceId: agentId,
              resourceType: 'agent',
              userId: ctx.userId,
              workspaceId: ctx.workspaceId!,
            }),
          ),
        );
      }

      // 3. Validate target workspace access once (user must be member+)
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

      // 4. Cannot transfer to the same workspace
      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent to the same workspace',
        });
      }

      // 5. The transfer rehomes every linked topic/message/thread/task — only
      //    the primary owner may move teammates' conversations along with
      //    agents. One batched check for the whole selection.
      if (
        ctx.workspaceId &&
        !(await isWorkspacePrimaryOwner({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })) &&
        (await ctx.agentModel.transferHasForeignRows(agentIds))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only the workspace owner can transfer an agent carrying others' conversations",
        });
      }

      let results;
      try {
        results = await ctx.agentModel.transferAgents(
          agentIds,
          input.targetWorkspaceId,
          ctx.userId,
          input.targetVisibility,
          {
            rejectForeignTopicCommentAuthors: isWorkspaceNonOwner(ctx),
          },
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can transfer agents carrying others' conversations",
          });
        }
        if (error instanceof AgentOwnedByGroupError) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.AgentOwnedByGroup, groups: error.groups } },
            code: 'CONFLICT',
            message: 'One of these agents belongs to a chat group and cannot be moved on its own',
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
            message: 'A previous transfer of these agents is still migrating their history',
          });
        }
        if (error instanceof Error && error.message === AGENT_SHARED_TRANSFER_BLOCKED) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.SharedTransferBlocked } },
            code: 'PRECONDITION_FAILED',
            message:
              'These agents cannot be transferred while a share link exists, including paused links.',
          });
        }
        throw error;
      }

      // The whole batch shares one backfill job; kick it post-commit.
      const batchTransferJobId = results[0]?.transferJobId;
      if (batchTransferJobId) startAgentTransferJob(ctx.serverDB, batchTransferJobId);

      if (ctx.workspaceId) {
        const sourcePermissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(
          agentIds.map((agentId) => sourcePermissionModel.removeAll('agent', agentId)),
        );
        // The agents left this workspace — void any live member-transfer requests.
        await new ResourceTransferRequestModel(
          ctx.serverDB,
          ctx.workspaceId,
        ).invalidateForResources('agent', agentIds);
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        const targetAccessLevel = input.targetAccessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent;
        const targetPermissionModel = new ResourcePermissionModel(
          ctx.serverDB,
          input.targetWorkspaceId,
        );
        await Promise.all(
          agentIds.map((agentId) =>
            targetPermissionModel.setAccessLevel('agent', agentId, targetAccessLevel, ctx.userId),
          ),
        );
      }

      return results;
    }),
};
