import { CreateAgentSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { AGENT_COPY_IN_PROGRESS } from '@/database/models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS } from '@/database/models/agentTransferJob';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { ResourceTransferRequestModel } from '@/database/models/resourceTransferRequest';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { createAgentDirectChannel } from '@/server/services/channel/defaultChannel';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { TrashService } from '@/server/services/trash';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from '../_helpers/assertWorkspaceRowManageable';
import { agentProcedure } from './procedures';

export const lifecycleRouter = router({
  /**
   * Check if an agent with the given marketIdentifier already exists
   */
  checkByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.checkByMarketIdentifier(input.marketIdentifier);
    }),
  /**
   * Count the agents matching the conditions of queryAgents — other virtual
   * rows excluded, and the inbox (Lobe AI) counted only when the caller passes
   * `includeInbox: true`. Lets paginated callers report real totals.
   */
  countAgents: agentProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          includeInbox: z.boolean().optional(),
          keyword: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.countAgents(input);
    }),
  /**
   * Create a standalone agent, with the creator's direct Channel to it while Channels are on.
   * Returns the created agent ID.
   */
  createAgent: agentProcedure
    .use(withScopedPermission('agent:create'))
    .input(
      z.object({
        config: CreateAgentSchema.optional(),
        groupId: z.string().optional(),
        /** The caller's own desktop, where a direct Channel to a local Agent runs. */
        localDeviceId: z.string().min(1).optional(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { localDeviceId, ...params } = input;
      const result = await ctx.agentService.createAgent(params);
      await createAgentDirectChannel({
        agentId: result.agentId,
        db: ctx.serverDB,
        localDeviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return result;
    }),
  /**
   * Create an agent without session.
   * Used for Group Agent Builder to create agents for groups.
   * Returns only the agent ID.
   */
  createAgentOnly: agentProcedure
    .use(withScopedPermission('agent:create'))
    .input(
      z.object({
        config: z.object({}).passthrough().optional(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Mutating the group's roster is a group edit — same ACL as
      // `agentGroup.addAgentsToGroup`. Check before creating the agent so a
      // denied call doesn't leave an orphan agent behind.
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      // Create the agent entity only (no session)
      const agent = await ctx.agentModel.create(input.config ?? {});

      // Add the agent to the group
      await ctx.chatGroupModel.addAgentToGroup(input.groupId, agent.id);

      if (ctx.workspaceId && agent.visibility !== 'private') {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          agent.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }

      return { agentId: agent.id };
    }),
  /**
   * Duplicate an agent and its associated session.
   * Returns the new agent ID and session ID.
   */
  duplicateAgent: agentProcedure
    .use(withScopedPermission('agent:fork'))
    .input(
      z.object({
        agentId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Forking creates a caller-owned Agent and is governed by `agent:fork`,
      // independently of the source Agent's collaborative-edit permission.
      const result = await ctx.agentModel.duplicate(input.agentId, input.newTitle);
      if (ctx.workspaceId && result) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          result.agentId,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }
      return result;
    }),
  /**
   * Get an agent by forkedFromIdentifier stored in params
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier: agentProcedure
    .input(
      z.object({
        forkedFromIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByForkedFromIdentifier(input.forkedFromIdentifier);
    }),
  /**
   * Get an agent by marketIdentifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByMarketIdentifier(input.marketIdentifier);
    }),
  /**
   * Query the user's agents with optional keyword filter — other virtual rows
   * excluded, and the inbox (Lobe AI) included and flagged with `isInbox` only
   * when the caller passes `includeInbox: true`.
   * Returns agents with minimal info (id, name, title, description, avatar,
   * backgroundColor).
   * Used by AddGroupMemberModal and group-management tool to search/select agents.
   */
  queryAgents: agentProcedure
    .input(
      z
        .object({
          includeInbox: z.boolean().optional(),
          keyword: z.string().optional(),
          limit: z.number().max(100).optional(),
          offset: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.queryAgents(input);
    }),
  rankAgents: agentProcedure.input(z.number().max(50).optional()).query(async ({ ctx, input }) => {
    return ctx.agentModel.rank(input);
  }),
  /**
   * Remove an agent and its associated session
   */
  removeAgent: agentProcedure
    .use(withScopedPermission('agent:delete'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'delete',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        // Same rule as transfer: the delete cascade erases every linked
        // session/topic/message, so a non-owner member must not take teammates'
        // conversations down with their own agent.
        if (
          isWorkspaceNonOwner(ctx) &&
          (await ctx.agentModel.transferHasForeignRows(input.agentId))
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can delete an agent carrying others' conversations",
          });
        }
      }
      let result;
      try {
        // Recycle bin: the agent, its session shells and every topic under it
        // are stamped, not dropped — the FK cascade only runs at purge time.
        result = await new TrashService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).trashAgent(input.agentId);
      } catch (error) {
        if (error instanceof Error && error.message === AGENT_COPY_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.CopyInProgress } },
            code: 'CONFLICT',
            message: 'A previous copy of this agent is still duplicating its history',
          });
        }
        // A backfill still maps this agent's message rows — deleting it now
        // would strand the job on a dangling `messages.agent_id`.
        if (error instanceof Error && error.message === AGENT_TRANSFER_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferInProgress } },
            code: 'CONFLICT',
            message: "A previous transfer of this agent's history is still migrating",
          });
        }
        throw error;
      }
      // Sharing grants are left in place while the agent sits in the bin (the
      // row is invisible anyway) so a restore brings them back; the purge
      // handler removes them for good. A pending handover is different: the
      // agent is invisible to the recipient too, so an acceptance would move
      // ownership of trashed content — void it now, as the hard delete did.
      if (ctx.workspaceId) {
        await new ResourceTransferRequestModel(
          ctx.serverDB,
          ctx.workspaceId,
        ).invalidateForResources('agent', [input.agentId]);
      }
      return result;
    }),
  /**
   * Pin or unpin an agent
   */
  updateAgentPinned: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        id: z.string(),
        pinned: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.update(input.id, { pinned: input.pinned });
    }),
});
