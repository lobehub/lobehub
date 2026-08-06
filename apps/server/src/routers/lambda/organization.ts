import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { OrganizationModel } from '@/database/models/organization';
import { aicoKeyOutbox, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  isBudgetPeriod,
  microUsdToDecimalString,
  tomanString,
  usdDecimalStringToMicro,
} from '@/database/utils/aicoMoney';
import { appEnv } from '@/envs/app';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertMockTopupAllowed } from '@/server/services/aico/mockTopupGate';
import {
  resolveTopupAmount,
  topupAmountInputSchema,
} from '@/server/services/aico/resolveTopupAmount';
import { EmailService } from '@/server/services/email';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { SmsService } from '@/server/services/sms';

const INVITE_EXPIRY_DAYS = 3;

const utcDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Invalid calendar date');

const mapOrgDateRangeError = (error: unknown): TRPCError => {
  const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
  if (
    message === 'INVALID_DATE_RANGE' ||
    message === 'DATE_RANGE_TOO_LARGE' ||
    message === 'MEMBER_NOT_FOUND'
  ) {
    return new TRPCError({ code: 'BAD_REQUEST', message });
  }
  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to load organization analytics',
  });
};

const serializeUsageChartPoint = (point: {
  costMicroUsd: number;
  date: string;
  totalTokens: number;
}) => ({
  costMicroUsd: String(point.costMicroUsd),
  costUsd: microUsdToDecimalString(point.costMicroUsd),
  date: point.date,
  totalTokens: point.totalTokens,
});

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
      : message === 'USER_ALREADY_IN_ORGANIZATION' || message === 'ORG_NOT_ACTIVE'
        ? 'CONFLICT'
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

      try {
        const org = await ctx.organizationModel.createOrganization({
          name: input.name,
          ownerUserId: ctx.userId,
          slug: input.slug,
        });
        return { id: org.id, name: org.name, publicCode: org.publicCode, slug: org.slug };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ORG_CREATE_FAILED';
        if (message === 'USER_ALREADY_IN_ORGANIZATION') {
          throw new TRPCError({ code: 'CONFLICT', message });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message });
      }
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
      z
        .object({
          email: z.string().email().optional(),
          identifierType: z.enum(['email', 'phone', 'public_user_id']).optional(),
          identifierValue: z.string().min(3).max(200).optional(),
          orgId: z.string().min(1),
          phone: z.string().min(8).max(32).optional(),
          publicUserId: z.string().min(3).max(64).optional(),
          role: z.enum(['admin', 'member']).default('member'),
        })
        .refine((v) => Boolean(v.identifierValue || v.email || v.phone || v.publicUserId), {
          message: 'INVITE_IDENTIFIER_REQUIRED',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

      const identifierType: 'email' | 'phone' | 'public_user_id' =
        input.identifierType ??
        (input.publicUserId ? 'public_user_id' : input.phone ? 'phone' : 'email');
      let identifierValue = (
        input.identifierValue ??
        input.publicUserId ??
        input.phone ??
        input.email ??
        ''
      ).trim();

      if (identifierType === 'email') {
        identifierValue = identifierValue.toLowerCase();
      } else if (identifierType === 'phone') {
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
        identifierType,
        identifierValue,
        invitedByUserId: ctx.userId,
        orgId: input.orgId,
        role: input.role,
      });

      const inviteUrl = `${appEnv.APP_URL}/invite/${invite.token}`;

      try {
        if (identifierType === 'email') {
          const emailService = new EmailService();
          await emailService.sendMail({
            html: `<p>You are invited to join <strong>${org.name}</strong> as <strong>${input.role}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>This link expires in ${INVITE_EXPIRY_DAYS} days.</p>`,
            subject: `Invitation to join ${org.name}`,
            text: `You are invited to join ${org.name} as ${input.role}. Open: ${inviteUrl}`,
            to: identifierValue,
          });
        } else if (identifierType === 'phone') {
          const smsService = new SmsService();
          await smsService.sendSms({
            message: `دعوت به ${org.name}: ${inviteUrl}`,
            to: identifierValue,
          });
        }
      } catch (error) {
        console.error('[organization] failed to deliver invite', error);
      }

      return {
        expiresAt: invite.expiresAt.toISOString(),
        id: invite.id,
        inviteUrl,
        role: invite.role,
      };
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
          publicUserId: await ctx.organizationModel.ensureUserPublicCode(ctx.userId),
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

      // Local access is already revocation_pending. Durable outbox handles OR
      // disable + settlement — OpenRouter downtime must not block removal.
      const budget = await ctx.organizationModel.getMemberBudget(input.memberId);
      await ctx.serverDB.insert(aicoKeyOutbox).values({
        action: 'reclaim_member',
        nextAttemptAt: new Date(),
        openrouterKeyId: budget?.openrouterKeyId ?? null,
        orgId: input.orgId,
        orgMemberId: input.memberId,
        payload: { createdByUserId: ctx.userId },
        status: 'pending',
        userId: updated.userId,
      });

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
        remainingMicroUsd: reclaimed.remainingMicroUsd,
      });

      return {
        orgBalanceMicroUsd: String(result.organization.walletBalanceMicroUsd ?? 0),
        orgBalanceUsd: microUsdToDecimalString(result.organization.walletBalanceMicroUsd ?? 0),
        reclaimedMicroUsd: String(reclaimed.remainingMicroUsd),
        reclaimedUsd: microUsdToDecimalString(reclaimed.remainingMicroUsd),
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
        balanceMicroUsd: String(org.walletBalanceMicroUsd ?? 0),
        balanceToman: tomanString(org.walletBalanceToman ?? 0),
        balanceUsd: microUsdToDecimalString(org.walletBalanceMicroUsd ?? 0),
        status: org.status,
      };
    }),

  mockOrgTopup: orgProcedure
    .input(
      topupAmountInputSchema.extend({
        orgId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      assertMockTopupAllowed();

      const { amountMicroUsd, amountToman, fxRateTomanPerUsd } = await resolveTopupAmount(input);
      const result = await ctx.organizationModel.addManualCredit({
        amountMicroUsd,
        amountToman,
        createdByUserId: ctx.userId,
        description: 'Mock org topup',
        fxRateTomanPerUsd,
        orgId: input.orgId,
        type: 'topup',
      });
      return {
        amountMicroUsd: String(amountMicroUsd),
        amountUsd: microUsdToDecimalString(amountMicroUsd),
        balanceMicroUsd: String(result.organization.walletBalanceMicroUsd ?? 0),
        balanceToman: tomanString(result.organization.walletBalanceToman ?? 0),
        balanceUsd: microUsdToDecimalString(result.organization.walletBalanceMicroUsd ?? 0),
        fxRate: String(fxRateTomanPerUsd),
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

      const stats = await ctx.organizationModel.getOrgDashboardStats(input.orgId);
      return {
        ...stats,
        allocatedMicroUsd: String(stats.allocatedMicroUsd),
        allocatedUsd: microUsdToDecimalString(stats.allocatedMicroUsd),
        balanceMicroUsd: String(stats.balanceMicroUsd),
        balanceToman: tomanString(stats.balanceToman),
        balanceUsd: microUsdToDecimalString(stats.balanceMicroUsd),
        estimatedUnusedMicroUsd: String(
          Math.max(0, stats.allocatedMicroUsd - stats.settledUsageMicroUsd),
        ),
        estimatedUnusedUsd: microUsdToDecimalString(
          Math.max(0, stats.allocatedMicroUsd - stats.settledUsageMicroUsd),
        ),
        grossNextRenewalMicroUsd: String(stats.grossNextRenewalMicroUsd),
        grossNextRenewalUsd: microUsdToDecimalString(stats.grossNextRenewalMicroUsd),
        members: stats.members.map((m) => ({
          ...m,
          periodAmountMicroUsd: String(m.periodAmountMicroUsd),
          periodAmountUsd: microUsdToDecimalString(m.periodAmountMicroUsd),
          remainingMicroUsd: String(m.remainingMicroUsd),
          remainingUsd: microUsdToDecimalString(m.remainingMicroUsd),
          reservedMicroUsd: String(m.reservedMicroUsd),
          settledUsageMicroUsd: String(m.settledUsageMicroUsd),
          settledUsageUsd: microUsdToDecimalString(m.settledUsageMicroUsd),
        })),
        nextRenewalAt: stats.nextRenewalAt?.toISOString() ?? null,
        settledUsageMicroUsd: String(stats.settledUsageMicroUsd),
        settledUsageUsd: microUsdToDecimalString(stats.settledUsageMicroUsd),
        shortfallMicroUsd: String(stats.shortfallMicroUsd),
        shortfallUsd: microUsdToDecimalString(stats.shortfallMicroUsd),
        unallocatedMicroUsd: String(stats.unallocatedMicroUsd),
        unallocatedUsd: microUsdToDecimalString(stats.unallocatedMicroUsd),
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
        /** Decimal USD string preferred; integer micro-USD string also accepted via amountMicroUsd. */
        amountUsd: z.string().min(1).optional(),
        amountMicroUsd: z.string().regex(/^\d+$/).optional(),
        orgId: z.string().min(1),
        orgMemberId: z.string().min(1),
        period: z.enum(['total', 'daily', 'weekly', 'monthly']).default('total'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      if (!isBudgetPeriod(input.period)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_PERIOD' });
      }

      let periodAmountMicroUsd: number;
      try {
        if (input.amountMicroUsd) {
          periodAmountMicroUsd = Number(input.amountMicroUsd);
        } else if (input.amountUsd) {
          periodAmountMicroUsd = Number(usdDecimalStringToMicro(input.amountUsd));
        } else {
          throw new Error('AMOUNT_REQUIRED');
        }
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_AMOUNT' });
      }

      try {
        const result = await ctx.organizationModel.allocateMemberCredit({
          createdByUserId: ctx.userId,
          orgId: input.orgId,
          orgMemberId: input.orgMemberId,
          period: input.period,
          periodAmountMicroUsd,
        });
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        await keyService.ensureMemberKey(input.orgMemberId);
        return {
          budgetPeriod: result.budget.period,
          budgetPeriodAmountMicroUsd: String(result.budget.periodAmountMicroUsd),
          budgetPeriodAmountUsd: microUsdToDecimalString(result.budget.periodAmountMicroUsd),
          orgBalanceMicroUsd: String(result.organization.walletBalanceMicroUsd ?? 0),
          orgBalanceUsd: microUsdToDecimalString(result.organization.walletBalanceMicroUsd ?? 0),
          reservedMicroUsd: String(result.budget.reservedMicroUsd),
          reservedUsd: microUsdToDecimalString(result.budget.reservedMicroUsd),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ALLOCATION_FAILED';
        throw new TRPCError({
          code: 'BAD_REQUEST',
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
        currentPeriodEnd: budget.currentPeriodEnd?.toISOString() ?? null,
        currentPeriodStart: budget.currentPeriodStart?.toISOString() ?? null,
        hasManagedKey: Boolean(budget.openrouterKeyId),
        isActive: budget.isActive,
        nextRenewalAt: budget.nextRenewalAt?.toISOString() ?? null,
        openrouterLimitReset: budget.openrouterLimitReset,
        period: budget.period,
        periodAmountMicroUsd: String(budget.periodAmountMicroUsd ?? 0),
        periodAmountUsd: microUsdToDecimalString(budget.periodAmountMicroUsd ?? 0),
        renewalStatus: budget.renewalStatus,
        reservedMicroUsd: String(budget.reservedMicroUsd ?? 0),
        reservedUsd: microUsdToDecimalString(budget.reservedMicroUsd ?? 0),
        settledUsageMicroUsd: String(budget.settledUsageMicroUsd ?? 0),
        settledUsageUsd: microUsdToDecimalString(budget.settledUsageMicroUsd ?? 0),
      };
    }),

  /** Org wallet statement for an inclusive UTC date range (`YYYY-MM-DD`). */
  getTransactionHistory: orgProcedure
    .input(
      z.object({
        from: utcDateSchema,
        limit: z.number().int().min(1).max(500).optional(),
        orgId: z.string().min(1),
        to: utcDateSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const rows = await ctx.organizationModel.getTransactionHistory({
          from: input.from,
          limit: input.limit,
          orgId: input.orgId,
          to: input.to,
        });
        return rows.map((row) => ({
          amountMicroUsd: String(row.amountMicroUsd ?? 0),
          amountToman: tomanString(row.amountToman ?? 0),
          amountUsd: microUsdToDecimalString(row.amountMicroUsd ?? 0),
          createdAt: row.createdAt.toISOString(),
          description: row.description,
          id: row.id,
          orgMemberId: row.orgMemberId,
          type: row.type,
        }));
      } catch (error) {
        throw mapOrgDateRangeError(error);
      }
    }),

  /** Daily org usage chart points for an inclusive UTC date range. */
  getOrgUsageChart: orgProcedure
    .input(z.object({ from: utcDateSchema, orgId: z.string().min(1), to: utcDateSchema }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const points = await ctx.organizationModel.getOrgUsageChart({
          from: input.from,
          orgId: input.orgId,
          to: input.to,
        });
        return points.map(serializeUsageChartPoint);
      } catch (error) {
        throw mapOrgDateRangeError(error);
      }
    }),

  /** Daily member usage chart points for an inclusive UTC date range. */
  getMemberUsageChart: orgProcedure
    .input(
      z.object({
        from: utcDateSchema,
        orgId: z.string().min(1),
        orgMemberId: z.string().min(1),
        to: utcDateSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      try {
        const points = await ctx.organizationModel.getMemberUsageChart({
          from: input.from,
          orgId: input.orgId,
          orgMemberId: input.orgMemberId,
          to: input.to,
        });
        return points.map(serializeUsageChartPoint);
      } catch (error) {
        throw mapOrgDateRangeError(error);
      }
    }),
});

export type OrganizationRouter = typeof organizationRouter;
