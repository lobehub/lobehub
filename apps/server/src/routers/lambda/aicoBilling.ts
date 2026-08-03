import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import { microUsdToDecimalString, tomanToMicroUsd } from '@/database/utils/aicoMoney';
import { aicoEnv } from '@/envs/aico';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getTomanPerUsd } from '@/server/services/aico/fxService';
import { assertMockTopupAllowed, isMockTopupUiEnabled } from '@/server/services/aico/mockTopupGate';
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

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Trial is disabled in production until atomic request quotas ship, and stays
 * disabled elsewhere unless both the env flag and the platform config opt in.
 * Missing/unset config defaults to disabled.
 */
const assertTrialAllowed = async (billingModel: AicoBillingModel): Promise<void> => {
  if (isProduction()) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'TRIAL_DISABLED_IN_PRODUCTION' });
  }
  if (!aicoEnv.AICO_ALLOW_TRIAL) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'TRIAL_DISABLED' });
  }
  const config = await billingModel.getTrialConfig();
  if (!config.enabled) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'TRIAL_DISABLED' });
  }
};

/** FX rates arrive as floats from the live feed; period math needs an integer rate. */
const toIntegerFxRate = (rate: number): number => {
  const rounded = Math.round(rate);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'INVALID_FX_RATE' });
  }
  return rounded;
};

const microToSafeInteger = (micro: bigint, label: string): number => {
  if (micro <= 0n) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `AMOUNT_MUST_BE_POSITIVE:${label}` });
  }
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `AMOUNT_TOO_LARGE:${label}` });
  }
  return Number(micro);
};

export const aicoBillingRouter = router({
  getFxRate: billingProcedure.query(async () => {
    const { rate, source } = await getTomanPerUsd();
    return { source, tomanPerUsd: toIntegerFxRate(rate) };
  }),

  getMyWallet: billingProcedure.query(async ({ ctx }) => {
    const [wallet, publicCode] = await Promise.all([
      ctx.billingModel.getOrCreateUserWallet(ctx.userId),
      ctx.organizationModel.ensureUserPublicCode(ctx.userId),
    ]);
    const balanceMicroUsd = Number(wallet.balanceMicroUsd ?? 0);
    return {
      // Money is always a string: micro-USD integers and 6-decimal USD, never a float.
      balanceMicroUsd: String(balanceMicroUsd),
      balanceToman: String(wallet.balanceToman ?? 0),
      balanceUsd: microUsdToDecimalString(balanceMicroUsd),
      hasManagedKey: Boolean(wallet.openrouterKeyId),
      isActive: wallet.isActive,
      mockTopupEnabled: isMockTopupUiEnabled(),
      preferredBillingSource: wallet.preferredBillingSource as 'personal' | 'organization',
      preferredOrganizationId: wallet.preferredOrganizationId,
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
      const rows = await ctx.billingModel.listUserUsage(ctx.userId, input?.limit ?? 50);
      return rows.map((row) => ({
        completionTokens: row.completionTokens,
        costMicroUsd: String(row.costMicroUsd),
        costUsd: microUsdToDecimalString(row.costMicroUsd),
        createdAt: row.createdAt,
        id: row.id,
        modelId: row.modelId,
        promptTokens: row.promptTokens,
        settlementStatus: row.settlementStatus,
        totalTokens: row.totalTokens,
      }));
    }),

  getMyTransactions: billingProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.billingModel.listUserTransactions(ctx.userId, input?.limit ?? 50);
      return rows.map((row) => ({
        amountMicroUsd: String(row.amountMicroUsd),
        amountToman: String(row.amountToman),
        amountUsd: microUsdToDecimalString(row.amountMicroUsd),
        createdAt: row.createdAt,
        description: row.description,
        id: row.id,
        type: row.type,
      }));
    }),

  /**
   * UX-only: remembers which wallet the SPA pre-selects. Every managed request
   * still carries an explicit billing context that is authorized server-side.
   */
  setBillingPreference: billingProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        source: z.enum(['personal', 'organization']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.source === 'organization') {
        if (!input.organizationId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'ORGANIZATION_ID_REQUIRED' });
        }
        const role = await ctx.organizationModel.getMemberRole(ctx.userId, input.organizationId);
        if (!role) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'ORG_MEMBERSHIP_REQUIRED' });
        }
      }

      const wallet = await ctx.billingModel.setBillingPreference({
        organizationId: input.organizationId,
        source: input.source,
        userId: ctx.userId,
      });

      return {
        preferredBillingSource: wallet.preferredBillingSource as 'personal' | 'organization',
        preferredOrganizationId: wallet.preferredOrganizationId,
      };
    }),

  mockTopup: billingProcedure
    .input(z.object({ amountToman: z.number().int().positive().max(100_000_000) }))
    .mutation(async ({ ctx, input }) => {
      assertMockTopupAllowed();

      const { rate } = await getTomanPerUsd();
      const fxRateTomanPerUsd = toIntegerFxRate(rate);
      const amountMicroUsd = microToSafeInteger(
        tomanToMicroUsd(input.amountToman, fxRateTomanPerUsd),
        'micro_usd',
      );

      const { wallet, transaction } = await ctx.billingModel.mockTopupUser({
        amountMicroUsd,
        amountToman: input.amountToman,
        createdByUserId: ctx.userId,
        fxRateTomanPerUsd,
        userId: ctx.userId,
      });

      await ctx.keyService.ensureUserKey(ctx.userId);

      return {
        amountMicroUsd: String(amountMicroUsd),
        amountUsd: microUsdToDecimalString(amountMicroUsd),
        balanceMicroUsd: String(wallet.balanceMicroUsd),
        balanceToman: String(wallet.balanceToman),
        balanceUsd: microUsdToDecimalString(wallet.balanceMicroUsd),
        fxRateTomanPerUsd,
        transactionId: transaction.id,
      };
    }),

  getMyTrial: billingProcedure.query(async ({ ctx }) => {
    const [trial, config, active] = await Promise.all([
      ctx.billingModel.getUserTrial(ctx.userId),
      ctx.billingModel.getTrialConfig(),
      ctx.billingModel.isTrialActive(ctx.userId),
    ]);

    // Production (and any environment without the explicit flags) must not
    // advertise a Trial the chat path would refuse to execute.
    const enabled = !isProduction() && aicoEnv.AICO_ALLOW_TRIAL && config.enabled;

    return {
      active: enabled && active,
      config: {
        allowedModelIds: JSON.parse(config.allowedModelIds || '[]') as string[],
        durationDays: config.durationDays,
        enabled,
        maxRequests: config.maxRequests,
        trialBudgetMicroUsd: String(config.trialBudgetMicroUsd),
        trialBudgetUsd: microUsdToDecimalString(config.trialBudgetMicroUsd),
      },
      trial:
        enabled && trial
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
    await assertTrialAllowed(ctx.billingModel);

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
        await ctx.keyService.ensureTrialKey(ctx.userId, Number(config.trialBudgetMicroUsd));
      } catch (error) {
        // Trial row already exists — the managed policy fails closed at chat time
        // when no key was provisioned, so don't roll back activation here.
        console.error('[aicoBilling] failed to provision trial OpenRouter key', error);
      }

      return {
        expiresAt: trial.expiresAt.toISOString(),
        startedAt: trial.startedAt.toISOString(),
        status: trial.status,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
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
    const [wallet, trialActive, orgs] = await Promise.all([
      ctx.billingModel.getUserWallet(ctx.userId),
      ctx.billingModel.isTrialActive(ctx.userId),
      ctx.organizationModel.listForUser(ctx.userId),
    ]);

    const hasOrgCredit = (
      await Promise.all(
        orgs.map(async (org) => {
          const members = await ctx.organizationModel.listMembers(org.id);
          const me = members.find((m) => m.userId === ctx.userId && m.status === 'active');
          if (!me) return false;
          const budget = await ctx.organizationModel.getMemberBudget(me.id);
          return Boolean(budget?.isActive && (budget.reservedMicroUsd ?? 0) > 0);
        }),
      )
    ).some(Boolean);

    return {
      brandName: 'Aico',
      hasCredit: Boolean(wallet?.openrouterKeyId) || trialActive || hasOrgCredit,
      managed: true,
      providerId: 'aico',
      runtimeProviderId: 'openrouter',
    };
  }),
});

export type AicoBillingRouter = typeof aicoBillingRouter;
