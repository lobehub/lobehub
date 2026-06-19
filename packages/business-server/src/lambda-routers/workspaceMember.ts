import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { WorkspaceModel } from '@/database/models/workspace';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const memberRoleSchema = z.enum(['owner', 'member', 'viewer']);

const assertWorkspaceMember = async (
  ctx: { userId: string; workspaceMemberModel: WorkspaceMemberModel },
  workspaceId: string,
) => {
  const membership = await ctx.workspaceMemberModel.getMember(workspaceId, ctx.userId);
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this workspace' });
  }

  return membership;
};

const assertWorkspaceOwner = async (
  ctx: { userId: string; workspaceMemberModel: WorkspaceMemberModel },
  workspaceId: string,
) => {
  const membership = await assertWorkspaceMember(ctx, workspaceId);
  if (membership.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only workspace owners can manage members' });
  }

  return membership;
};

const memberProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceAuditLogModel: new WorkspaceAuditLogModel(ctx.serverDB),
      workspaceMemberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId),
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const workspaceMemberRouter = router({
  acceptInvitation: memberProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.workspaceMemberModel.findInvitationByToken(input.token);
      if (!invitation || invitation.status !== 'pending') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
      }
      if (invitation.expiresAt.getTime() < Date.now()) {
        await ctx.workspaceMemberModel.updateInvitationStatus(invitation.id, 'expired');
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation expired' });
      }

      const member = await ctx.workspaceMemberModel.addMember({
        role: invitation.role as 'owner' | 'member' | 'viewer',
        userId: ctx.userId,
        workspaceId: invitation.workspaceId,
      });
      await ctx.workspaceMemberModel.updateInvitationStatus(invitation.id, 'accepted');
      await ctx.workspaceAuditLogModel.create({
        action: 'member.joined',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { invitationId: invitation.id, role: member.role },
        resourceId: ctx.userId,
        resourceType: 'workspace_member',
        userId: ctx.userId,
        workspaceId: invitation.workspaceId,
      });

      return member;
    }),

  add: memberProcedure
    .input(
      z.object({
        role: memberRoleSchema.optional(),
        userId: z.string(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);

      const member = await ctx.workspaceMemberModel.addMember(input);
      await ctx.workspaceAuditLogModel.create({
        action: 'member.joined',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { role: member.role },
        resourceId: member.userId,
        resourceType: 'workspace_member',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return member;
    }),

  list: memberProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);

      return ctx.workspaceMemberModel.listMembers(input.workspaceId);
    }),

  listInvitations: memberProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);

      return ctx.workspaceMemberModel.listPendingInvitations(input.workspaceId);
    }),

  invite: memberProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: memberRoleSchema.optional(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);

      const invitation = await ctx.workspaceMemberModel.createInvitation(input);
      await ctx.workspaceAuditLogModel.create({
        action: 'member.invited',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { email: invitation.email, role: invitation.role },
        resourceId: invitation.id,
        resourceType: 'workspace_invitation',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });

      return invitation;
    }),

  remove: memberProcedure
    .input(z.object({ userId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const actor = await ctx.workspaceMemberModel.getMember(input.workspaceId, ctx.userId);
      if (actor?.role !== 'owner' && input.userId !== ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owners can remove other members' });
      }

      await ctx.workspaceMemberModel.removeMember(input.workspaceId, input.userId);
      await ctx.workspaceAuditLogModel.create({
        action: input.userId === ctx.userId ? 'member.left' : 'member.removed',
        ipAddress: ctx.clientIp ?? undefined,
        resourceId: input.userId,
        resourceType: 'workspace_member',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }),

  revokeInvitation: memberProcedure
    .input(z.object({ id: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);

      await ctx.workspaceMemberModel.revokeInvitation(input.id);
      await ctx.workspaceAuditLogModel.create({
        action: 'invitation.revoked',
        ipAddress: ctx.clientIp ?? undefined,
        resourceId: input.id,
        resourceType: 'workspace_invitation',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }),

  updateRole: memberProcedure
    .input(z.object({ role: memberRoleSchema, userId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);

      if (input.role === 'owner') {
        await ctx.workspaceModel.promoteToOwner(input.workspaceId, input.userId);
      } else {
        const workspace = await ctx.workspaceModel.findById(input.workspaceId);
        if (workspace?.primaryOwnerId === input.userId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Transfer primary ownership before demoting this owner',
          });
        }

        await ctx.workspaceMemberModel.updateMemberRole(
          input.workspaceId,
          input.userId,
          input.role,
        );
      }

      await ctx.workspaceAuditLogModel.create({
        action: 'member.role_updated',
        ipAddress: ctx.clientIp ?? undefined,
        metadata: { role: input.role },
        resourceId: input.userId,
        resourceType: 'workspace_member',
        userId: ctx.userId,
        workspaceId: input.workspaceId,
      });
    }),
});
