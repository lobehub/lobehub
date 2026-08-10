import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import { session, users, userWallets } from '@/database/schemas';
import {
  microUsdToDecimalString,
  tomanString,
  usdDecimalStringToMicro,
} from '@/database/utils/aicoMoney';
import { revokeOIDCArtifactsByUserId } from '@/libs/oidc-provider/access-control';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTomanPerUsd } from '@/server/services/aico/fxService';
import { refreshAicoMasterMonitorState } from '@/server/services/aico/masterMonitor';
import {
  resolveTopupAmount,
  topupAmountInputSchema,
} from '@/server/services/aico/resolveTopupAmount';
import { recordAicoSecurityEvent } from '@/server/services/aico/securityAudit';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { OpenRouterModelCatalogSyncService } from '@/server/services/openrouter/modelCatalogSync';

/**
 * Platform-admin procedures live on the Aico control plane only.
 * Do not mount this router on the customer product lambda.
 */

const platformProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const organizationModel = new OrganizationModel(ctx.serverDB);
  const allowed = await organizationModel.isPlatformAdmin(ctx.userId);
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin required' });
  }
  return next({
    ctx: {
      billingModel: new AicoBillingModel(ctx.serverDB),
      modelCatalogSync: new OpenRouterModelCatalogSyncService(ctx.serverDB),
      organizationModel,
    },
  });
});

export const platformAdminRouter = router({
  /**
   * Soft gate for the control-plane SPA: authenticated users learn whether they
   * are platform admins without throwing FORBIDDEN (so the UI can stay on login /
   * "not allowed" instead of the admin panel shell).
   */
  checkAccess: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    const organizationModel = new OrganizationModel(ctx.serverDB);
    const isPlatformAdmin = await organizationModel.isPlatformAdmin(ctx.userId);
    return { isPlatformAdmin, userId: ctx.userId };
  }),

  /** FX helper for the control-plane admin UI (replaces aicoBilling.getFxRate there). */
  getFxRate: platformProcedure.query(async () => {
    const { rate, source } = await getTomanPerUsd();
    return { source, tomanPerUsd: Math.round(rate) };
  }),

  listOrganizations: platformProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          query: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.organizationModel.listOrganizations(input ?? {});
    }),

  createOrganization: platformProcedure
    .input(
      z.object({
        managerEmail: z.string().email().optional(),
        managerUserId: z.string().min(1).optional(),
        name: z.string().min(1).max(120),
        slug: z.string().min(1).max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let ownerUserId = input.managerUserId;
      if (!ownerUserId && input.managerEmail) {
        ownerUserId =
          (await ctx.organizationModel.findUserIdByEmail(input.managerEmail)) ?? undefined;
      }
      if (!ownerUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'managerUserId or existing managerEmail is required',
        });
      }

      const org = await ctx.organizationModel.createOrganization({
        name: input.name,
        ownerUserId,
        slug: input.slug,
      });
      await recordAicoSecurityEvent(ctx.serverDB, {
        action: 'platform.org.create',
        actorUserId: ctx.userId,
        ipAddress: ctx.clientIp,
        metadata: { name: org.name, slug: org.slug },
        organizationId: org.id,
        targetId: org.id,
        targetType: 'organization',
        userAgent: ctx.userAgent,
      });
      return { id: org.id, name: org.name, publicCode: org.publicCode, slug: org.slug };
    }),

  assignManager: platformProcedure
    .input(
      z.object({
        managerEmail: z.string().email().optional(),
        orgId: z.string().min(1),
        role: z.enum(['owner', 'admin']).default('admin'),
        userId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let userId = input.userId;
      if (!userId && input.managerEmail) {
        userId = (await ctx.organizationModel.findUserIdByEmail(input.managerEmail)) ?? undefined;
      }
      if (!userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'userId or existing managerEmail is required',
        });
      }

      const org = await ctx.organizationModel.getById(input.orgId);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

      return ctx.organizationModel
        .assignManager({
          orgId: input.orgId,
          role: input.role,
          userId,
        })
        .then(async (row) => {
          await recordAicoSecurityEvent(ctx.serverDB, {
            action: 'platform.org.assign_manager',
            actorUserId: ctx.userId,
            ipAddress: ctx.clientIp,
            metadata: { role: input.role, targetUserId: userId },
            organizationId: input.orgId,
            targetId: userId,
            targetType: 'user',
            userAgent: ctx.userAgent,
          });
          return row;
        });
    }),

  suspendOrganization: platformProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.organizationModel.setOrganizationStatus(input.orgId, 'suspended');
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

        // Fail closed: a suspended org's members must lose OpenRouter access immediately,
        // not just at the next usage-sync poll.
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        await keyService.disableAllOrgMemberKeys(input.orgId);

        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'platform.org.suspend',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          organizationId: input.orgId,
          targetId: input.orgId,
          targetType: 'organization',
          userAgent: ctx.userAgent,
        });

        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : 'SUSPEND_FAILED';
        if (message === 'ORG_ALREADY_DELETED') {
          throw new TRPCError({ code: 'BAD_REQUEST', message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  activateOrganization: platformProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.organizationModel.setOrganizationStatus(input.orgId, 'active');
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });
        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'platform.org.activate',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          organizationId: input.orgId,
          targetId: input.orgId,
          targetType: 'organization',
          userAgent: ctx.userAgent,
        });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : 'ACTIVATE_FAILED';
        if (message === 'ORG_ALREADY_DELETED') {
          throw new TRPCError({ code: 'BAD_REQUEST', message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  addManualCredit: platformProcedure
    .input(
      topupAmountInputSchema.extend({
        description: z.string().max(500).optional(),
        orgId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { amountMicroUsd, amountToman, fxRateTomanPerUsd } = await resolveTopupAmount(input);
        const result = await ctx.organizationModel.addManualCredit({
          amountMicroUsd,
          amountToman,
          createdByUserId: ctx.userId,
          description: input.description,
          fxRateTomanPerUsd,
          orgId: input.orgId,
          type: 'manual_credit',
        });
        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'platform.credit.org_add',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          metadata: {
            amountMicroUsd,
            amountToman,
            transactionId: result.transaction.id,
          },
          organizationId: input.orgId,
          targetId: result.transaction.id,
          targetType: 'wallet_transaction',
          userAgent: ctx.userAgent,
        });
        return {
          organization: {
            ...result.organization,
            walletBalanceMicroUsd: String(result.organization.walletBalanceMicroUsd ?? 0),
            walletBalanceUsd: microUsdToDecimalString(
              result.organization.walletBalanceMicroUsd ?? 0,
            ),
          },
          transaction: {
            ...result.transaction,
            amountMicroUsd: String(result.transaction.amountMicroUsd ?? 0),
            amountUsd: microUsdToDecimalString(result.transaction.amountMicroUsd ?? 0),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to add credit',
        });
      }
    }),

  addManualUserCredit: platformProcedure
    .input(
      topupAmountInputSchema.extend({
        description: z.string().max(500).optional(),
        email: z.string().email().optional(),
        publicCode: z.string().min(1).max(32).optional(),
        userId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let userId = input.userId;
      if (!userId && input.email) {
        userId = (await ctx.organizationModel.findUserIdByEmail(input.email)) ?? undefined;
      }
      if (!userId && input.publicCode) {
        userId = (await ctx.organizationModel.getUserIdByPublicCode(input.publicCode)) ?? undefined;
      }
      if (!userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'userId, email, or publicCode of an existing user is required',
        });
      }

      try {
        const { amountMicroUsd, amountToman, fxRateTomanPerUsd } = await resolveTopupAmount(input);
        const result = await ctx.billingModel.manualCreditUser({
          amountMicroUsd,
          amountToman,
          createdByUserId: ctx.userId,
          description: input.description,
          fxRateTomanPerUsd,
          userId,
        });

        // Ensure the user can spend the new balance via a managed key.
        const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
        await keyService.ensureUserKey(userId);

        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'platform.credit.user_add',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          metadata: {
            amountMicroUsd,
            amountToman,
            targetUserId: userId,
            transactionId: result.transaction.id,
          },
          targetId: userId,
          targetType: 'user',
          userAgent: ctx.userAgent,
        });

        return {
          transaction: {
            ...result.transaction,
            amountMicroUsd: String(result.transaction.amountMicroUsd ?? 0),
            amountToman: tomanString(result.transaction.amountToman ?? 0),
            amountUsd: microUsdToDecimalString(result.transaction.amountMicroUsd ?? 0),
          },
          userId,
          wallet: {
            balanceMicroUsd: String(result.wallet.balanceMicroUsd ?? 0),
            balanceToman: tomanString(result.wallet.balanceToman ?? 0),
            balanceUsd: microUsdToDecimalString(result.wallet.balanceMicroUsd ?? 0),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to add user credit',
        });
      }
    }),

  addPlatformAdmin: platformProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        userId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let userId = input.userId;
      if (!userId && input.email) {
        const row = await ctx.serverDB.query.users.findFirst({
          where: eq(users.email, input.email.trim().toLowerCase()),
        });
        userId = row?.id;
      }
      if (!userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'userId or email is required' });
      }
      return ctx.organizationModel.addPlatformAdmin(userId).then(async (row) => {
        await recordAicoSecurityEvent(ctx.serverDB, {
          action: 'platform.admin.add',
          actorUserId: ctx.userId,
          ipAddress: ctx.clientIp,
          metadata: { targetUserId: userId },
          targetId: userId,
          targetType: 'user',
          userAgent: ctx.userAgent,
        });
        return row;
      });
    }),

  listPlatformAdmins: platformProcedure.query(async ({ ctx }) => {
    return ctx.organizationModel.listPlatformAdmins();
  }),

  getTrialConfig: platformProcedure.query(async ({ ctx }) => {
    const config = await ctx.billingModel.getTrialConfig();
    return {
      allowedModelIds: JSON.parse(config.allowedModelIds || '[]') as string[],
      durationDays: config.durationDays,
      enabled: config.enabled,
      maxRequests: config.maxRequests,
      trialBudgetMicroUsd: String(config.trialBudgetMicroUsd ?? 0),
      trialBudgetUsd: microUsdToDecimalString(config.trialBudgetMicroUsd ?? 0),
    };
  }),

  updateTrialConfig: platformProcedure
    .input(
      z.object({
        allowedModelIds: z.array(z.string()).optional(),
        durationDays: z.number().int().min(1).max(90).optional(),
        enabled: z.boolean().optional(),
        maxRequests: z.number().int().positive().nullable().optional(),
        trialBudgetUsd: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const trialBudgetMicroUsd =
        input.trialBudgetUsd !== undefined
          ? Number(usdDecimalStringToMicro(input.trialBudgetUsd))
          : undefined;
      const row = await ctx.billingModel.updateTrialConfig({
        allowedModelIds: input.allowedModelIds,
        durationDays: input.durationDays,
        enabled: input.enabled,
        maxRequests: input.maxRequests,
        trialBudgetMicroUsd,
        updatedByUserId: ctx.userId,
      });
      return {
        allowedModelIds: JSON.parse(row.allowedModelIds || '[]') as string[],
        durationDays: row.durationDays,
        enabled: row.enabled,
        maxRequests: row.maxRequests,
        trialBudgetMicroUsd: String(row.trialBudgetMicroUsd ?? 0),
        trialBudgetUsd: microUsdToDecimalString(row.trialBudgetMicroUsd ?? 0),
      };
    }),

  getPlatformFinancials: platformProcedure
    .input(
      z
        .object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx }) => {
      const [txs, wallets, orgBalanceMicroUsd, totalOpenRouterCostMicroUsd, fx] = await Promise.all(
        [
          ctx.billingModel.listRecentTransactions(200),
          ctx.billingModel.listAllWallets(),
          ctx.organizationModel.getTotalWalletBalanceMicroUsd(),
          ctx.billingModel.sumUsageCostMicroUsd(),
          getTomanPerUsd(),
        ],
      );
      const topups = txs.filter((t) => t.type === 'topup' || t.type === 'manual_credit');
      const totalRevenueToman = topups.reduce((sum, t) => sum + Number(t.amountToman || 0), 0);
      const totalMicroCredited = Math.trunc(
        topups.reduce((sum, t) => sum + Number(t.amountMicroUsd || 0), 0),
      );
      const b2cBalanceMicroUsd = Math.trunc(
        wallets.reduce((sum, w) => sum + Number(w.balanceMicroUsd || 0), 0),
      );
      // SUM/driver may yield a float; FX is integer toman/USD from getTomanPerUsd.
      const costMicroUsd = Math.trunc(Number(totalOpenRouterCostMicroUsd) || 0);
      const fxRate = Math.round(fx.rate);
      // Approximate margin in toman using integer FX (floored).
      const costTomanEstimate = Number((BigInt(costMicroUsd) * BigInt(fxRate)) / 1_000_000n);
      const marginToman = totalRevenueToman - costTomanEstimate;

      return {
        b2bBalanceMicroUsd: String(Math.trunc(Number(orgBalanceMicroUsd) || 0)),
        b2bBalanceUsd: microUsdToDecimalString(Math.trunc(Number(orgBalanceMicroUsd) || 0)),
        b2cBalanceMicroUsd: String(b2cBalanceMicroUsd),
        b2cBalanceUsd: microUsdToDecimalString(b2cBalanceMicroUsd),
        b2cWalletCount: wallets.length,
        from: null as string | null,
        marginToman: String(Math.trunc(marginToman)),
        recentTransactions: txs.slice(0, 50).map((t) => ({
          amountMicroUsd: String(t.amountMicroUsd ?? 0),
          amountToman: tomanString(t.amountToman ?? 0),
          amountUsd: microUsdToDecimalString(t.amountMicroUsd ?? 0),
          createdAt: t.createdAt.toISOString(),
          id: t.id,
          orgId: t.orgId,
          type: t.type,
          userId: t.userId,
        })),
        to: null as string | null,
        totalOpenRouterCostMicroUsd: String(costMicroUsd),
        totalOpenRouterCostUsd: microUsdToDecimalString(costMicroUsd),
        totalRevenueToman: String(Math.trunc(totalRevenueToman)),
        totalUsdCredited: microUsdToDecimalString(totalMicroCredited),
      };
    }),

  getMasterAccountStatus: platformProcedure.query(async ({ ctx }) => {
    const usageMicro = await ctx.billingModel.sumUsageCostMicroUsd();
    const status = await refreshAicoMasterMonitorState(ctx.serverDB, usageMicro);
    return {
      balanceUsd: null as string | null,
      belowThreshold: status.belowThreshold,
      isStub: status.isStub,
      lastSuccessfulCheckAt: status.lastSuccessfulCheckAt,
      status: status.status,
      thresholdUsd: status.thresholdUsd,
      totalObservedUsageUsd: status.totalObservedUsageUsd,
    };
  }),

  listUserWallets: platformProcedure.query(async ({ ctx }) => {
    const wallets = await ctx.billingModel.listAllWallets();
    const userIds = wallets.map((w) => w.userId);
    const [publicCodes, identities] = await Promise.all([
      ctx.organizationModel.getUserPublicCodesByIds(userIds),
      ctx.organizationModel.getUserIdentitiesByIds(userIds),
    ]);
    return wallets.map((w) => {
      const identity = identities.get(w.userId);
      return {
        balanceMicroUsd: String(w.balanceMicroUsd ?? 0),
        balanceToman: tomanString(w.balanceToman ?? 0),
        balanceUsd: microUsdToDecimalString(w.balanceMicroUsd ?? 0),
        banReason: identity?.banReason ?? null,
        banned: Boolean(identity?.banned),
        email: identity?.email ?? null,
        hasManagedKey: Boolean(w.openrouterKeyId),
        isActive: w.isActive,
        publicCode: publicCodes.get(w.userId) ?? null,
        userId: w.userId,
        username: identity?.username ?? null,
      };
    });
  }),

  deactivateUser: platformProcedure
    .input(
      z.object({
        reason: z.string().trim().min(1).max(500),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot deactivate yourself' });
      }

      const [user] = await ctx.serverDB
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      await ctx.serverDB
        .update(users)
        .set({
          banExpires: null,
          banReason: input.reason,
          banned: true,
        })
        .where(eq(users.id, input.userId));

      await ctx.serverDB.delete(session).where(eq(session.userId, input.userId));
      await revokeOIDCArtifactsByUserId(ctx.serverDB, input.userId);

      await ctx.serverDB
        .update(userWallets)
        .set({ isActive: false })
        .where(eq(userWallets.userId, input.userId));

      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      await keyService.disableUserKey(input.userId);

      return { ok: true as const };
    }),

  reactivateUser: platformProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.serverDB
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      await ctx.serverDB
        .update(users)
        .set({
          banExpires: null,
          banReason: null,
          banned: false,
        })
        .where(eq(users.id, input.userId));

      await ctx.serverDB
        .update(userWallets)
        .set({ isActive: true })
        .where(eq(userWallets.userId, input.userId));

      return { ok: true as const };
    }),

  getOpenRouterModelSyncStatus: platformProcedure.query(async ({ ctx }) => {
    return ctx.modelCatalogSync.getStatus();
  }),

  listOpenRouterModelSyncHistory: platformProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.modelCatalogSync.listHistory(input?.limit ?? 20);
    }),

  syncOpenRouterModels: platformProcedure.mutation(async ({ ctx }) => {
    const status = await ctx.modelCatalogSync.sync(`manual:${ctx.userId}`);
    if (status.lastStatus !== 'success') {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: status.lastError || 'OpenRouter model sync failed',
      });
    }
    return status;
  }),
});

export type PlatformAdminRouter = typeof platformAdminRouter;
