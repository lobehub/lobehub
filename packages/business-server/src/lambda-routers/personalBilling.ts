import { TRPCError } from '@trpc/server';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { users, userSettings } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { isSuperAdmin } from '../enterprise/superAdmin';

const PERSONAL_PLANS = [
  {
    description:
      'Личный аккаунт без выданного баланса. Доступ к интерфейсу сохраняется, генерация через Acensus AI требует кредитов.',
    id: 'free',
    limits: { monthlyTokens: 0, workspaces: 0 },
    name: 'Free',
  },
  {
    description:
      'Ручной баланс для личных сценариев: тесты, демо, персональные агенты и проверка моделей.',
    id: 'personal',
    limits: { monthlyTokens: -1, workspaces: 1 },
    name: 'Personal',
  },
] as const;

const getMarket = async (ctx: { serverDB: LobeChatDatabase }, userId: string) => {
  const row = await ctx.serverDB.query.userSettings.findFirst({
    columns: { market: true },
    where: eq(userSettings.id, userId),
  });

  return (row?.market as Record<string, unknown> | null) ?? {};
};

const saveMarket = async (
  ctx: { serverDB: LobeChatDatabase },
  userId: string,
  market: Record<string, unknown>,
) => {
  await ctx.serverDB
    .insert(userSettings)
    .values({ id: userId, market })
    .onConflictDoUpdate({ set: { market }, target: userSettings.id });
};

const resolveUser = async (ctx: { serverDB: LobeChatDatabase }, identity: string) => {
  const value = identity.trim();
  if (!value) return null;

  return ctx.serverDB.query.users.findFirst({
    columns: { email: true, fullName: true, id: true, normalizedEmail: true },
    where: or(
      eq(users.id, value),
      eq(users.email, value),
      eq(users.normalizedEmail, value.toLowerCase()),
    ),
  });
};

export const personalBillingRouter = router({
  get: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    const market = await getMarket(ctx, ctx.userId);
    const credits = Number(market.personalCreditBalance ?? 0);
    const plan = credits > 0 ? 'personal' : 'free';

    return {
      credits,
      currency: String(market.personalCreditCurrency ?? 'internal'),
      isSuperAdmin: await isSuperAdmin(ctx.serverDB, ctx.userId),
      ledger: Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : [],
      plan,
      plans: PERSONAL_PLANS,
    };
  }),

  grantCredits: authedProcedure
    .use(serverDatabase)
    .input(
      z.object({
        amount: z.number().positive(),
        note: z.string().max(500).optional(),
        user: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await isSuperAdmin(ctx.serverDB, ctx.userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Только super-admin может выдавать кредиты',
        });
      }

      const target = await resolveUser(ctx, input.user);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Пользователь не найден' });

      const market = await getMarket(ctx, target.id);
      const current = Number(market.personalCreditBalance ?? 0);
      const ledger = Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : [];
      const nextBalance = current + input.amount;

      await saveMarket(ctx, target.id, {
        ...market,
        personalCreditBalance: nextBalance,
        personalCreditCurrency: 'internal',
        personalCreditLedger: [
          ...ledger,
          {
            actorUserId: ctx.userId,
            amount: input.amount,
            at: new Date().toISOString(),
            balanceAfter: nextBalance,
            note: input.note,
            type: 'admin_grant',
          },
        ],
      });

      return {
        balance: nextBalance,
        user: {
          email: target.email,
          id: target.id,
          name: target.fullName,
        },
      };
    }),
});
