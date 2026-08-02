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
import { assertMockTopupAllowed } from '@/server/services/aico/mockTopupGate';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

const billingProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      billingModel: new AicoBillingModel(ctx.serverDB),
      keyService: new AicoOpenRouterKeyService(ctx.serverDB),
      organizationModel: new OrganizationModel(ctx.serverDB),
    },
  });
});

export const aicoBillingRouter = router({
  getFxRate: billingProcedure.query(async () => {
    const { rate, source } = await getTomanPerUsd();
    return { source, tomanPerUsd: rate };
  }),

  getMyWallet: billingProcedure.query(async ({ ctx }) => {
    const [wallet, publicCode] = await Promise.all([
      ctx.billingModel.getOrCreateUserWallet(ctx.userId),
      ctx.organizationModel.ensureUserPublicCode(ctx.userId),
    ]);
    return {
      balanceToman: wallet.balanceToman,
      balanceUsd: Number(wallet.balanceUsd),
      hasManagedKey: Boolean(wallet.openrouterKeyId),
      isActive: wallet.isActive,
      publicCode,
      // Never expose key material
    };
  }),

  getMyPublicCode: billingProcedure.query(async ({ ctx }) => {
    return { publicCode: await ctx.organizationModel.ensureUserPublicCode(ctx.userId) };
  }),

  getMyUsage: billingProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.billingModel.listUserUsage(ctx.userId, input?.limit ?? 50);
    }),

  getMyTransactions: billingProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.billingModel.listUserTransactions(ctx.userId, input?.limit ?? 50);
    }),

  mockTopup: billingProcedure
    .input(z.object({ amountToman: z.number().int().positive().max(100_000_000) }))
    .mutation(async ({ ctx, input }) => {
      assertMockTopupAllowed();

      const { rate: fxRate } = await getTomanPerUsd();
      const amountUsd = tomanToUsd(input.amountToman, fxRate);

      const { wallet, transaction } = await ctx.billingModel.mockTopupUser({
        amountToman: input.amountToman,
        amountUsd,
        createdByUserId: ctx.userId,
        fxRate,
        userId: ctx.userId,
      });

      await ctx.keyService.ensureUserKey(ctx.userId);

      return {
        amountUsd,
        balanceToman: wallet.balanceToman,
        balanceUsd: Number(wallet.balanceUsd),
        fxRate,
        transactionId: transaction.id,
      };
    }),

  getMyTrial: billingProcedure.query(async ({ ctx }) => {
    const [trial, config, active] = await Promise.all([
      ctx.billingModel.getUserTrial(ctx.userId),
      ctx.billingModel.getTrialConfig(),
      ctx.billingModel.isTrialActive(ctx.userId),
    ]);
    return {
      active,
      config: {
        allowedModelIds: JSON.parse(config.allowedModelIds || '[]') as string[],
        durationDays: config.durationDays,
        enabled: config.enabled,
        maxRequests: config.maxRequests,
        trialBudgetUsd: Number(config.trialBudgetUsd),
      },
      trial: trial
        ? {
            expiresAt: trial.expiresAt.toISOString(),
            requestCount: trial.requestCount,
            startedAt: trial.startedAt.toISOString(),
            status: trial.status,
          }
        : null,
    };
  }),

  activateTrial: billingProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.serverDB.query.users.findFirst({
      where: eq(users.id, ctx.userId),
    });
    if (!user?.phone || !user.phoneNumberVerified) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'PHONE_VERIFICATION_REQUIRED',
      });
    }

    try {
      const trial = await ctx.billingModel.activateTrial({
        phone: user.phone,
        userId: ctx.userId,
      });

      const config = await ctx.billingModel.getTrialConfig();
      try {
        await ctx.keyService.ensureTrialKey(ctx.userId, Number(config.trialBudgetUsd));
      } catch (error) {
        // Trial row is already created — surface the failure via resolveManagedApiKey
        // at chat time (fail closed) rather than rolling back trial activation here.
        console.error('[aicoBilling] failed to provision trial OpenRouter key', error);
      }

      return {
        expiresAt: trial.expiresAt.toISOString(),
        startedAt: trial.startedAt.toISOString(),
        status: trial.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TRIAL_FAILED';
      throw new TRPCError({
        code:
          message === 'TRIAL_DISABLED'
            ? 'FORBIDDEN'
            : message.startsWith('TRIAL_')
              ? 'BAD_REQUEST'
              : 'INTERNAL_SERVER_ERROR',
        message,
      });
    }
  }),

  /**
   * Provider surface hint — never returns keys.
   * Aico is always white-label managed OpenRouter for every signed-in user:
   * they top up / get org credit / activate trial, and we provision limited
   * keys server-side. The SPA must never show the multi-provider catalog.
   */
  getManagedProviderStatus: billingProcedure.query(async ({ ctx }) => {
    const [wallet, trialActive, hasOrgOrWalletKey] = await Promise.all([
      ctx.billingModel.getUserWallet(ctx.userId),
      ctx.billingModel.isTrialActive(ctx.userId),
      ctx.keyService.resolveUserApiKey(ctx.userId).then((k) => Boolean(k)),
    ]);
    return {
      brandName: 'Aico',
      hasCredit: Boolean(wallet?.openrouterKeyId) || trialActive || hasOrgOrWalletKey,
      managed: true,
      providerId: 'aico',
      runtimeProviderId: 'openrouter',
    };
  }),
});

export type AicoBillingRouter = typeof aicoBillingRouter;
