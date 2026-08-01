import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { tomanToUsd } from '@/envs/aico';
import { appEnv } from '@/envs/app';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTomanPerUsd } from '@/server/services/aico/fxService';
import { assertMockTopupAllowed } from '@/server/services/aico/mockTopupGate';
import { EmailService } from '@/server/services/email';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { SmsService } from '@/server/services/sms';

const INVITE_EXPIRY_DAYS = 3;

const requireVerifiedPhone = async (serverDB: LobeChatDatabase, userId: string) => {
  const user = await serverDB.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.phone || !user.phoneNumberVerified) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'PHONE_VERIFICATION_REQUIRED' });
  }
  return user;
};

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
      await requireVerifiedPhone(ctx.serverDB, ctx.userId);

      const org = await ctx.organizationModel.createOrganization({
        name: input.name,
        ownerUserId: ctx.userId,
        slug: input.slug,
      });
      return { id: org.id, name: org.name, publicCode: org.publicCode, slug: org.slug };
    }),

  /**
   * B2C → B2B upgrade: create the caller's first organization from their personal
   * account. Requires a verified phone (org managers must be reachable/accountable).
   */
  convertToManagement: orgProcedure
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await requireVerifiedPhone(ctx.serverDB, ctx.userId);

      const existing = await ctx.organizationModel.listForUser(ctx.userId, {
        includeSuspended: true,
      });
      if (existing.some((o) => o.myRole === 'owner')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ALREADY_HAS_ORGANIZATION' });
      }

      const org = await ctx.organizationModel.createOrganization({
        name: input.name,
        ownerUserId: ctx.userId,
      });
      return { id: org.id, name: org.name, publicCode: org.publicCode, slug: org.slug };
    }),

  getMine: orgProcedure.query(async ({ ctx }) => {
    return ctx.organizationModel.listForUser(ctx.userId, { includeSuspended: true });
  }),

  listMembers: orgProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const [members, invites] = await Promise.all([
        ctx.organizationModel.listMembersWithPublicCodes(input.orgId),
        ctx.organizationModel.listPendingInvites(input.orgId),
      ]);
      return {
        // Never leak raw invite tokens through a list endpoint — only the
        // `inviteMember` mutation response carries the token, for the inviter to share.
        invites: invites.map((i) => ({
          expiresAt: i.expiresAt.toISOString(),
          id: i.id,
          identifierType: i.identifierType,
          identifierValue: i.identifierValue,
          role: i.role,
        })),
        members,
      };
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
      let updated;
      try {
        updated = await ctx.organizationModel.removeMember(input);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to remove member',
        });
      }

      // Reclaim only the OpenRouter-reported remaining credit back to the org
      // wallet; the member is already disabled above, so a reclaim failure here
      // never re-grants access — it can be retried via `revokeMemberBudget`.
      try {
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        const reclaimed = await keyService.reclaimMemberKey(input.memberId);
        if (reclaimed) {
          await ctx.organizationModel.reclaimMemberRemainingCredit({
            createdByUserId: ctx.userId,
            orgId: input.orgId,
            orgMemberId: input.memberId,
            remainingUsd: reclaimed.remainingUsd,
          });
        }
      } catch (error) {
        console.error('[organization] failed to reclaim member key on removeMember', error);
      }

      return updated;
    }),

  /** Explicit credit reclaim without removing the member — e.g. pausing an active member's budget. */
  revokeMemberBudget: orgProcedure
    .input(z.object({ orgId: z.string().min(1), orgMemberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      const reclaimed = await keyService.reclaimMemberKey(input.orgMemberId);
      if (!reclaimed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No managed key to reclaim' });
      }

      const result = await ctx.organizationModel.reclaimMemberRemainingCredit({
        createdByUserId: ctx.userId,
        orgId: input.orgId,
        orgMemberId: input.orgMemberId,
        remainingUsd: reclaimed.remainingUsd,
      });

      return {
        orgBalanceUsd: Number(result.organization.walletBalanceUsd),
        reclaimedUsd: reclaimed.remainingUsd,
      };
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
      assertMockTopupAllowed();

      const { rate: fxRate } = await getTomanPerUsd();
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

  /** Org manager dashboard: wallet + per-member allocation/usage, with best-effort OR usage sync. */
  getDashboard: orgProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      const members = await ctx.organizationModel.listMembers(input.orgId);
      await Promise.allSettled(
        members
          .filter((m) => m.status === 'active')
          .map(async (m) => {
            const budget = await ctx.organizationModel.getMemberBudget(m.id);
            if (budget?.openrouterKeyId) await keyService.syncMemberUsage(m.id);
          }),
      );

      return ctx.organizationModel.getOrgDashboardStats(input.orgId);
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
