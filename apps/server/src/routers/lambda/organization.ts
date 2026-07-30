import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import { aicoEnv, tomanToUsd } from '@/envs/aico';
import { appEnv } from '@/envs/app';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EmailService } from '@/server/services/email';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { SmsService } from '@/server/services/sms';

const INVITE_EXPIRY_DAYS = 3;

const orgProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      organizationModel: new OrganizationModel(ctx.serverDB),
    },
  });
});

const requireOrgManager = async (
  model: OrganizationModel,
  userId: string,
  orgId: string,
): Promise<'owner' | 'admin'> => {
  const isPlatform = await model.isPlatformAdmin(userId);
  if (isPlatform) return 'owner';

  const role = await model.getMemberRole(userId, orgId);
  if (role === 'owner' || role === 'admin') return role;

  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not an organization manager' });
};

const mapInviteError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'INVITE_FAILED';
  const code =
    message === 'INVITE_NOT_FOUND' || message === 'INVITE_EXPIRED'
      ? 'NOT_FOUND'
      : message === 'INVITE_IDENTIFIER_MISMATCH' || message === 'INVITE_NOT_PENDING'
        ? 'BAD_REQUEST'
        : 'INTERNAL_SERVER_ERROR';
  throw new TRPCError({ code, message });
};

export const organizationRouter = router({
  create: orgProcedure
    .input(
      z.object({ name: z.string().min(1).max(120), slug: z.string().min(1).max(80).optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.organizationModel.createOrganization({
        name: input.name,
        ownerUserId: ctx.userId,
        slug: input.slug,
      });
      return { id: org.id, name: org.name, slug: org.slug };
    }),

  getMine: orgProcedure.query(async ({ ctx }) => {
    return ctx.organizationModel.listForUser(ctx.userId);
  }),

  listMembers: orgProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const [members, invites] = await Promise.all([
        ctx.organizationModel.listMembers(input.orgId),
        ctx.organizationModel.listPendingInvites(input.orgId),
      ]);
      return { invites, members };
    }),

  inviteMember: orgProcedure
    .input(
      z.object({
        identifierType: z.enum(['email', 'phone']),
        identifierValue: z.string().min(3).max(200),
        orgId: z.string().min(1),
        role: z.enum(['admin', 'member']).default('member'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

      let identifierValue = input.identifierValue.trim();
      if (input.identifierType === 'email') {
        identifierValue = identifierValue.toLowerCase();
      } else {
        const normalized = normalizeIranianPhoneNumber(identifierValue);
        if (!normalized) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid phone number' });
        }
        identifierValue = normalized;
      }

      const org = await ctx.organizationModel.getById(input.orgId);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });
      if (org.status === 'suspended') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Organization is suspended' });
      }

      const invite = await ctx.organizationModel.createInvite({
        identifierType: input.identifierType,
        identifierValue,
        invitedByUserId: ctx.userId,
        orgId: input.orgId,
        role: input.role,
      });

      const inviteUrl = `${appEnv.APP_URL}/invite/${invite.token}`;

      try {
        if (input.identifierType === 'email') {
          const emailService = new EmailService();
          await emailService.sendMail({
            html: `<p>You are invited to join <strong>${org.name}</strong> as <strong>${input.role}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>This link expires in ${INVITE_EXPIRY_DAYS} days.</p>`,
            subject: `Invitation to join ${org.name}`,
            text: `You are invited to join ${org.name} as ${input.role}. Open: ${inviteUrl}`,
            to: identifierValue,
          });
        } else {
          const smsService = new SmsService();
          await smsService.sendSms({
            message: `دعوت به ${org.name}: ${inviteUrl}`,
            to: identifierValue,
          });
        }
      } catch (error) {
        console.error('[organization] failed to deliver invite', error);
        // Invite row remains; caller can resend / share link
      }

      return invite;
    }),

  acceptInvite: orgProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Load session user email/phone from DB via model helpers isn't enough —
      // pull from better-auth session isn't on ctx; look up user row.
      const user = await ctx.serverDB.query.users.findFirst({
        where: eq(users.id, ctx.userId),
      });

      try {
        return await ctx.organizationModel.acceptInvite({
          email: user?.email,
          phone: user?.phone,
          token: input.token,
          userId: ctx.userId,
        });
      } catch (error) {
        return mapInviteError(error);
      }
    }),

  updateMemberRole: orgProcedure
    .input(
      z.object({
        memberId: z.string().min(1),
        orgId: z.string().min(1),
        role: z.enum(['owner', 'admin', 'member']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      if (input.role === 'owner' && role !== 'owner') {
        const isPlatform = await ctx.organizationModel.isPlatformAdmin(ctx.userId);
        if (!isPlatform) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owner can transfer ownership' });
        }
      }

      try {
        const updated = await ctx.organizationModel.updateMemberRole(input);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        return updated;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to update role',
        });
      }
    }),

  removeMember: orgProcedure
    .input(z.object({ memberId: z.string().min(1), orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const updated = await ctx.organizationModel.removeMember(input);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
        return updated;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to remove member',
        });
      }
    }),

  revokeInvite: orgProcedure
    .input(z.object({ inviteId: z.string().min(1), orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const revoked = await ctx.organizationModel.revokeInvite(input);
      if (!revoked) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      return revoked;
    }),

  getInvitePreview: orgProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.organizationModel.getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      const org = await ctx.organizationModel.getById(invite.orgId);
      return {
        expiresAt: invite.expiresAt.toISOString(),
        identifierType: invite.identifierType,
        orgName: org?.name ?? '',
        role: invite.role,
        status: invite.status,
      };
    }),

  getOrgWallet: orgProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const org = await ctx.organizationModel.getById(input.orgId);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });
      return {
        balanceToman: org.walletBalanceToman,
        balanceUsd: Number(org.walletBalanceUsd),
        status: org.status,
      };
    }),

  mockOrgTopup: orgProcedure
    .input(
      z.object({
        amountToman: z.number().int().positive().max(100_000_000),
        orgId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const fxRate = aicoEnv.AICO_TOMAN_PER_USD;
      const amountUsd = tomanToUsd(input.amountToman, fxRate);
      const result = await ctx.organizationModel.addManualCredit({
        amountToman: input.amountToman,
        amountUsd,
        createdByUserId: ctx.userId,
        description: 'Mock org topup',
        fxRate,
        orgId: input.orgId,
        type: 'topup',
      });
      return {
        amountUsd,
        balanceToman: result.organization.walletBalanceToman,
        balanceUsd: Number(result.organization.walletBalanceUsd),
        fxRate,
      };
    }),

  listTeams: orgProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const teams = await ctx.organizationModel.listTeams(input.orgId);
      const withModels = await Promise.all(
        teams.map(async (team) => ({
          ...team,
          modelIds: (await ctx.organizationModel.getTeamModelAccess(team.id)).map((r) => r.modelId),
        })),
      );
      return withModels;
    }),

  createTeam: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        orgId: z.string().min(1),
        slug: z.string().min(1).max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      return ctx.organizationModel.createTeam(input);
    }),

  deleteTeam: orgProcedure
    .input(z.object({ orgId: z.string().min(1), teamId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const deleted = await ctx.organizationModel.deleteTeam(input);
        if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
        return deleted;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to delete team',
        });
      }
    }),

  assignMemberToTeam: orgProcedure
    .input(
      z.object({
        orgId: z.string().min(1),
        orgMemberId: z.string().min(1),
        teamId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        return await ctx.organizationModel.assignMemberToTeam(input);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to assign team',
        });
      }
    }),

  setTeamModels: orgProcedure
    .input(
      z.object({
        modelIds: z.array(z.string().min(1)).max(200),
        orgId: z.string().min(1),
        teamId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        return await ctx.organizationModel.setTeamModelAccess(input);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to set models',
        });
      }
    }),

  allocateMemberCredit: orgProcedure
    .input(
      z.object({
        amountUsd: z.number().positive().max(1_000_000),
        orgId: z.string().min(1),
        orgMemberId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const result = await ctx.organizationModel.allocateMemberCredit({
          amountUsd: input.amountUsd,
          createdByUserId: ctx.userId,
          orgId: input.orgId,
          orgMemberId: input.orgMemberId,
        });
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        await keyService.ensureMemberKey(input.orgMemberId);
        return {
          budgetLimitUsd: Number(result.budget.limitUsd),
          orgBalanceUsd: Number(result.organization.walletBalanceUsd),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ALLOCATION_FAILED';
        throw new TRPCError({
          code: message === 'INSUFFICIENT_ORG_BALANCE' ? 'BAD_REQUEST' : 'BAD_REQUEST',
          message,
        });
      }
    }),

  getMemberBudget: orgProcedure
    .input(z.object({ orgId: z.string().min(1), orgMemberId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const budget = await ctx.organizationModel.getMemberBudget(input.orgMemberId);
      if (!budget) return null;
      return {
        hasManagedKey: Boolean(budget.openrouterKeyId),
        isActive: budget.isActive,
        limitUsd: Number(budget.limitUsd),
        usedUsd: Number(budget.usedUsd),
      };
    }),
});

export type OrganizationRouter = typeof organizationRouter;
