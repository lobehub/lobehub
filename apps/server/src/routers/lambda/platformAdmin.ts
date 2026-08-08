import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import {
  microUsdToDecimalString,
  tomanString,
  usdDecimalStringToMicro,
} from '@/database/utils/aicoMoney';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTomanPerUsd } from '@/server/services/aico/fxService';
import {
  resolveTopupAmount,
  topupAmountInputSchema,
} from '@/server/services/aico/resolveTopupAmount';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';
import { OpenRouterModelCatalogSyncService } from '@/server/services/openrouter/modelCatalogSync';

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

      return ctx.organizationModel.assignManager({
        orgId: input.orgId,
        role: input.role,
        userId,
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
      return ctx.organizationModel.addPlatformAdmin(userId);
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
    // OpenRouter Management API has no documented master prepaid-balance endpoint.
    // Never fabricate a real balance — report observed usage + unknown status.
    const usageMicro = await ctx.billingModel.sumUsageCostMicroUsd();
    return {
      balanceUsd: null as string | null,
      belowThreshold: null as boolean | null,
      isStub: true,
      lastSuccessfulCheckAt: null as string | null,
      status: 'unknown' as const,
      thresholdUsd: '100.000000',
      totalObservedUsageUsd: microUsdToDecimalString(usageMicro),
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
        email: identity?.email ?? null,
        hasManagedKey: Boolean(w.openrouterKeyId),
        isActive: w.isActive,
        publicCode: publicCodes.get(w.userId) ?? null,
        userId: w.userId,
        username: identity?.username ?? null,
      };
    });
  }),

  getOpenRouterModelSyncStatus: platformProcedure.query(async ({ ctx }) => {
    return ctx.modelCatalogSync.getStatus();
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
