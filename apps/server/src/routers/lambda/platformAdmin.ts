import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import { tomanToUsd } from '@/envs/aico';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTomanPerUsd } from '@/server/services/aico/fxService';
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
      const row = await ctx.organizationModel.setOrganizationStatus(input.orgId, 'suspended');
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });

      // Fail closed: a suspended org's members must lose OpenRouter access immediately,
      // not just at the next usage-sync poll.
      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      await keyService.disableAllOrgMemberKeys(input.orgId);

      return row;
    }),

  activateOrganization: platformProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.organizationModel.setOrganizationStatus(input.orgId, 'active');
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' });
      return row;
    }),

  addManualCredit: platformProcedure
    .input(
      z.object({
        amountToman: z.number().int().positive(),
        description: z.string().max(500).optional(),
        orgId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { rate: fxRate } = await getTomanPerUsd();
        const amountUsd = tomanToUsd(input.amountToman, fxRate);
        return await ctx.organizationModel.addManualCredit({
          amountToman: input.amountToman,
          amountUsd,
          createdByUserId: ctx.userId,
          description: input.description,
          fxRate,
          orgId: input.orgId,
          type: 'manual_credit',
        });
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to add credit',
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
      trialBudgetUsd: Number(config.trialBudgetUsd),
    };
  }),

  updateTrialConfig: platformProcedure
    .input(
      z.object({
        allowedModelIds: z.array(z.string()).optional(),
        durationDays: z.number().int().min(1).max(90).optional(),
        enabled: z.boolean().optional(),
        maxRequests: z.number().int().positive().nullable().optional(),
        trialBudgetUsd: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.billingModel.updateTrialConfig({
        ...input,
        updatedByUserId: ctx.userId,
      });
      return {
        allowedModelIds: JSON.parse(row.allowedModelIds || '[]') as string[],
        durationDays: row.durationDays,
        enabled: row.enabled,
        maxRequests: row.maxRequests,
        trialBudgetUsd: Number(row.trialBudgetUsd),
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
      const [txs, wallets, orgBalanceUsd, totalOpenRouterCostUsd, fx] = await Promise.all([
        ctx.billingModel.listRecentTransactions(200),
        ctx.billingModel.listAllWallets(),
        ctx.organizationModel.getTotalWalletBalanceUsd(),
        ctx.billingModel.sumUsageCostUsd(),
        getTomanPerUsd(),
      ]);
      const topups = txs.filter((t) => t.type === 'topup' || t.type === 'manual_credit');
      const totalRevenueToman = topups.reduce((sum, t) => sum + Number(t.amountToman || 0), 0);
      const totalUsdCredited = topups.reduce((sum, t) => sum + Number(t.amountUsd || 0), 0);
      const b2cBalanceUsd = wallets.reduce((sum, w) => sum + Number(w.balanceUsd || 0), 0);
      // Approximate margin: revenue collected minus observed OpenRouter spend, converted
      // at the current live rate (individual topups may have used a different historical rate).
      const marginToman = totalRevenueToman - totalOpenRouterCostUsd * fx.rate;

      return {
        b2bBalanceUsd: String(orgBalanceUsd),
        b2cBalanceUsd: String(b2cBalanceUsd),
        b2cWalletCount: wallets.length,
        from: null as string | null,
        marginToman: String(Math.round(marginToman)),
        recentTransactions: txs.slice(0, 50).map((t) => ({
          amountToman: t.amountToman,
          amountUsd: t.amountUsd == null ? null : Number(t.amountUsd),
          createdAt: t.createdAt.toISOString(),
          id: t.id,
          orgId: t.orgId,
          type: t.type,
          userId: t.userId,
        })),
        to: null as string | null,
        totalOpenRouterCostUsd: String(totalOpenRouterCostUsd),
        totalRevenueToman: String(totalRevenueToman),
        totalUsdCredited: String(totalUsdCredited),
      };
    }),

  getMasterAccountStatus: platformProcedure.query(async ({ ctx }) => {
    // OpenRouter's management API has no "account balance" endpoint for the master key,
    // so this can't report the real remaining prepaid credit — only observed spend from
    // our own usage logs. `balanceUsd`/`belowThreshold` stay stubbed until OpenRouter
    // ships an account-credits endpoint.
    const usageUsd = await ctx.billingModel.sumUsageCostUsd();
    return {
      balanceUsd: '0',
      belowThreshold: false,
      isStub: true,
      thresholdUsd: '100',
      totalObservedUsageUsd: String(usageUsd),
    };
  }),

  listUserWallets: platformProcedure.query(async ({ ctx }) => {
    const wallets = await ctx.billingModel.listAllWallets();
    const publicCodes = await ctx.organizationModel.getUserPublicCodesByIds(
      wallets.map((w) => w.userId),
    );
    return wallets.map((w) => ({
      balanceToman: w.balanceToman,
      balanceUsd: Number(w.balanceUsd),
      hasManagedKey: Boolean(w.openrouterKeyId),
      isActive: w.isActive,
      publicCode: publicCodes.get(w.userId) ?? null,
      userId: w.userId,
    }));
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
