import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { OrganizationModel } from '@/database/models/organization';
import { aicoKeyOutbox, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  microUsdToDecimalString,
  tomanString,
  usdDecimalStringToMicro,
} from '@/database/utils/aicoMoney';
import { appEnv } from '@/envs/app';
import { normalizeIranianPhoneNumber } from '@/libs/better-auth/phone';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { recordAicoSecurityEvent } from '@/server/services/aico/securityAudit';
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

/** Owner-only gate — platform admins cannot soft-delete orgs via this path. */
const requireOrgOwner = async (
  model: OrganizationModel,
  userId: string,
  orgId: string,
): Promise<void> => {
  const role = await model.getMemberRole(userId, orgId);
  if (role === 'owner') return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the organization owner can delete it' });
};

const mapOrgDeleteError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'ORG_DELETE_FAILED';
  if (message === 'ORG_NOT_FOUND') {
    throw new TRPCError({ code: 'NOT_FOUND', message });
  }
  if (
    message === 'ORG_NAME_MISMATCH' ||
    message === 'ORG_WALLET_NOT_EMPTY' ||
    message === 'ORG_HAS_PENDING_RENEWAL' ||
    message === 'ORG_ALREADY_DELETED'
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'ORG_DELETE_FAILED',
  });
};

/** Reject cross-tenant orgMemberId before any budget/key side effect. */
const requireMemberInOrg = async (model: OrganizationModel, orgId: string, orgMemberId: string) => {
  const member = await model.getMemberInOrg({ orgId, orgMemberId });
  if (!member) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
  }
  return member;
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

  /**
   * Models the current user may use when spending from their org wallet.
   * Personal wallet callers should ignore this (unrestricted managed catalog).
   * Empty array = no models granted for the member's team.
   */
  getMyAllowedModels: orgProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.organizationModel.listMembers(input.organizationId);
      const me = members.find((m) => m.userId === ctx.userId && m.status === 'active');
      if (!me) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'ORG_MEMBERSHIP_REQUIRED' });
      }
      const allowed = await ctx.organizationModel.getAllowedModelsForMember(me.id);
      return { modelIds: allowed ?? [] };
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

      await recordAicoSecurityEvent(ctx.serverDB, {
        action: 'org.member.invite',
        actorUserId: ctx.userId,
        ipAddress: ctx.clientIp,
        metadata: {
          identifierType,
          // Never log raw phone/email values — only type + invite id
          inviteId: invite.id,
          role: input.role,
        },
        organizationId: input.orgId,
        targetId: invite.id,
        targetType: 'organization_invite',
        userAgent: ctx.userAgent,
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
        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'org.member.role_update',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          metadata: { memberId: input.memberId, role: input.role },
          organizationId: input.orgId,
          targetId: input.memberId,
          targetType: 'organization_member',
          userAgent: ctx.userAgent,
        });
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

      // OR-005: best-effort sync disable so the OR key stops spending immediately.
      // Durable outbox still owns settlement + retry if OpenRouter is down.
      const budget = await ctx.organizationModel.getMemberBudgetForOrg({
        orgId: input.orgId,
        orgMemberId: input.memberId,
      });
      if (budget?.openrouterKeyId) {
        try {
          const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
          await keyService.disableMemberKey(input.memberId);
        } catch (error) {
          console.warn(
            '[aico] sync disableMemberKey on remove failed; outbox will retry reclaim',
            error,
          );
        }
      }
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

      await recordAicoSecurityEvent(ctx.serverDB, {
        action: 'org.member.remove',
        actorUserId: ctx.userId,
        ipAddress: ctx.clientIp,
        metadata: { memberId: input.memberId, targetUserId: updated.userId },
        organizationId: input.orgId,
        targetId: input.memberId,
        targetType: 'organization_member',
        userAgent: ctx.userAgent,
      });

      return updated;
    }),

  /** Explicit credit reclaim without removing the member — e.g. pausing an active member's budget. */
  revokeMemberBudget: orgProcedure
    .input(z.object({ orgId: z.string().min(1), orgMemberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      // TENANT-001: prove orgMemberId ∈ orgId before any OpenRouter disable.
      await requireMemberInOrg(ctx.organizationModel, input.orgId, input.orgMemberId);

      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      const reclaimed = await keyService.reclaimMemberKey({
        orgId: input.orgId,
        orgMemberId: input.orgMemberId,
      });
      if (!reclaimed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No managed key to reclaim' });
      }

      const result = await ctx.organizationModel.reclaimMemberRemainingCredit({
        createdByUserId: ctx.userId,
        orgId: input.orgId,
        orgMemberId: input.orgMemberId,
        remainingMicroUsd: reclaimed.remainingMicroUsd,
      });

      await recordAicoSecurityEvent(ctx.serverDB, {
        action: 'org.key.reclaim_member',
        actorUserId: ctx.userId,
        ipAddress: ctx.clientIp,
        metadata: { remainingMicroUsd: reclaimed.remainingMicroUsd },
        organizationId: input.orgId,
        targetId: input.orgMemberId,
        targetType: 'organization_member',
        userAgent: ctx.userAgent,
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
      // Never return the raw token — managers already have getInviteLink for URL recovery.
      return {
        expiresAt: revoked.expiresAt.toISOString(),
        id: revoked.id,
        identifierType: revoked.identifierType,
        identifierValue: revoked.identifierValue,
        role: revoked.role,
        status: revoked.status,
      };
    }),

  /**
   * On-demand invite URL for org managers (AICO-92).
   * Keeps listMembers token-free (AICO-P1-026) while allowing recovery after the
   * one-shot post-invite modal is closed.
   */
  getInviteLink: orgProcedure
    .input(z.object({ inviteId: z.string().min(1), orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const invite = await ctx.organizationModel.getInviteById(input);
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      if (invite.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite is not pending' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite expired' });
      }
      return {
        expiresAt: invite.expiresAt.toISOString(),
        id: invite.id,
        inviteUrl: `${appEnv.APP_URL}/invite/${invite.token}`,
      };
    }),

  getInvitePreview: orgProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.organizationModel.getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      // TENANT-008: only pending, unexpired invites may disclose org metadata.
      if (invite.status !== 'pending') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      }
      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      }
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
          pendingPeriodAmountMicroUsd: String(m.pendingPeriodAmountMicroUsd),
          pendingPeriodAmountUsd: microUsdToDecimalString(m.pendingPeriodAmountMicroUsd),
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
        idempotencyKey: z.string().min(8).max(128).optional(),
        orgId: z.string().min(1),
        orgMemberId: z.string().min(1),
        /** Required product period — no silent default (AICO-140). */
        period: z.enum(['daily', 'weekly', 'monthly']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

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

      if (
        !Number.isSafeInteger(periodAmountMicroUsd) ||
        periodAmountMicroUsd <= 0 ||
        periodAmountMicroUsd > 100_000_000_000_000 // $100M micro-USD cap
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_AMOUNT' });
      }

      // Sync OR usage before a possible mid-period decrease so clamp uses fresh consumption.
      try {
        const existing = await ctx.organizationModel.getMemberBudgetForOrg({
          orgId: input.orgId,
          orgMemberId: input.orgMemberId,
        });
        if (
          existing &&
          existing.period === input.period &&
          periodAmountMicroUsd < Number(existing.periodAmountMicroUsd ?? 0)
        ) {
          const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
          await keyService.syncMemberUsage(input.orgMemberId);
        }
      } catch {
        // Best-effort — allocate still clamps to settledUsageMicroUsd on hand.
      }

      try {
        const result = await ctx.organizationModel.allocateMemberCredit({
          createdByUserId: ctx.userId,
          idempotencyKey: input.idempotencyKey,
          orgId: input.orgId,
          orgMemberId: input.orgMemberId,
          period: input.period,
          periodAmountMicroUsd,
        });
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        await keyService.ensureMemberKey(input.orgMemberId);
        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'org.budget.allocate',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          metadata: {
            idempotencyKey: input.idempotencyKey ?? null,
            period: input.period,
            periodAmountMicroUsd,
            transactionId: result.transaction?.id ?? null,
          },
          organizationId: input.orgId,
          targetId: input.orgMemberId,
          targetType: 'organization_member',
          userAgent: ctx.userAgent,
        });
        return {
          budgetPeriod: result.budget.period,
          budgetPeriodAmountMicroUsd: String(result.budget.periodAmountMicroUsd),
          budgetPeriodAmountUsd: microUsdToDecimalString(result.budget.periodAmountMicroUsd),
          orgBalanceMicroUsd: String(result.organization.walletBalanceMicroUsd ?? 0),
          orgBalanceUsd: microUsdToDecimalString(result.organization.walletBalanceMicroUsd ?? 0),
          pendingPeriod: result.budget.pendingPeriod ?? null,
          pendingPeriodAmountUsd: result.budget.pendingPeriodAmountMicroUsd
            ? microUsdToDecimalString(result.budget.pendingPeriodAmountMicroUsd)
            : null,
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
      // TENANT-002: never load budget by orgMemberId alone across tenants.
      const budget = await ctx.organizationModel.getMemberBudgetForOrg({
        orgId: input.orgId,
        orgMemberId: input.orgMemberId,
      });
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

  /**
   * Soft-delete organization (owner only). Requires typing the exact org name
   * and a zero wallet balance. Preserves financial history; disables keys.
   */
  deleteOrganization: orgProcedure
    .input(
      z.object({
        confirmName: z.string().min(1).max(120),
        orgId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgOwner(ctx.organizationModel, ctx.userId, input.orgId);

      let result: Awaited<ReturnType<OrganizationModel['softDeleteOrganization']>>;
      try {
        result = await ctx.organizationModel.softDeleteOrganization({
          confirmName: input.confirmName,
          orgId: input.orgId,
        });
      } catch (error) {
        return mapOrgDeleteError(error);
      }

      // Fail closed: members must lose OpenRouter access immediately.
      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      await keyService.disableAllOrgMemberKeys(input.orgId);

      await recordAicoSecurityEvent(ctx.serverDB, {
        action: 'org.key.disable_all',
        actorUserId: ctx.userId,
        ipAddress: ctx.clientIp,
        metadata: { reason: 'org_deleted' },
        organizationId: input.orgId,
        targetId: input.orgId,
        targetType: 'organization',
        userAgent: ctx.userAgent,
      });

      for (const member of result.membersToReclaim) {
        await ctx.serverDB.insert(aicoKeyOutbox).values({
          action: 'reclaim_member',
          nextAttemptAt: new Date(),
          openrouterKeyId: member.openrouterKeyId,
          orgId: input.orgId,
          orgMemberId: member.memberId,
          payload: { createdByUserId: ctx.userId, reason: 'org_deleted' },
          status: 'pending',
          userId: member.userId,
        });
      }

      return {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        status: result.organization.status,
      };
    }),
});

export type OrganizationRouter = typeof organizationRouter;
