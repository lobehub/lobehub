import { TRPCError } from '@trpc/server';
import { count, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { users, userSettings, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { isSuperAdmin } from '../enterprise/superAdmin';

const planSchema = z.enum(['starter', 'business', 'enterprise']);

const adminProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  if (!(await isSuperAdmin(opts.ctx.serverDB, opts.ctx.userId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Требуется super-admin доступ' });
  }

  return opts.next();
});

const getMarket = async (db: LobeChatDatabase, userId: string) => {
  const row = await db.query.userSettings.findFirst({
    columns: { market: true },
    where: eq(userSettings.id, userId),
  });

  return (row?.market as Record<string, unknown> | null) ?? {};
};

const saveMarket = async (
  db: LobeChatDatabase,
  userId: string,
  market: Record<string, unknown>,
) => {
  await db
    .insert(userSettings)
    .values({ id: userId, market })
    .onConflictDoUpdate({ set: { market }, target: userSettings.id });
};

const resolveUser = async (db: LobeChatDatabase, identity: string) => {
  const value = identity.trim();

  return db.query.users.findFirst({
    columns: {
      email: true,
      fullName: true,
      id: true,
      normalizedEmail: true,
      role: true,
      username: true,
    },
    where: or(
      eq(users.id, value),
      eq(users.email, value),
      eq(users.normalizedEmail, value.toLowerCase()),
    ),
  });
};

const getWorkspaceSettings = async (db: LobeChatDatabase, workspaceId: string) => {
  const workspace = await db.query.workspaces.findFirst({
    columns: { settings: true },
    where: eq(workspaces.id, workspaceId),
  });

  return (workspace?.settings as Record<string, unknown> | null) ?? {};
};

const updateWorkspaceSettings = async (
  db: LobeChatDatabase,
  workspaceId: string,
  patch: Record<string, unknown>,
) => {
  const settings = await getWorkspaceSettings(db, workspaceId);
  await db
    .update(workspaces)
    .set({ settings: { ...settings, ...patch }, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
};

export const businessAdminRouter = router({
  overview: adminProcedure.query(async ({ ctx }) => {
    const [userTotal, workspaceTotal, latestUsers, latestWorkspaces] = await Promise.all([
      ctx.serverDB.select({ count: count() }).from(users),
      ctx.serverDB.select({ count: count() }).from(workspaces),
      ctx.serverDB
        .select({
          createdAt: users.createdAt,
          email: users.email,
          fullName: users.fullName,
          id: users.id,
          lastActiveAt: users.lastActiveAt,
          market: userSettings.market,
          role: users.role,
          username: users.username,
        })
        .from(users)
        .leftJoin(userSettings, eq(users.id, userSettings.id))
        .orderBy(desc(users.updatedAt))
        .limit(24),
      ctx.serverDB.query.workspaces.findMany({
        limit: 24,
        orderBy: [desc(workspaces.updatedAt)],
      }),
    ]);

    return {
      totals: {
        users: userTotal[0]?.count ?? 0,
        workspaces: workspaceTotal[0]?.count ?? 0,
      },
      users: latestUsers.map((user) => {
        const market = (user.market as Record<string, unknown> | null) ?? {};
        return {
          ...user,
          personalCredits: Number(market.personalCreditBalance ?? 0),
        };
      }),
      workspaces: latestWorkspaces.map((workspace) => {
        const settings = (workspace.settings as Record<string, unknown> | null) ?? {};
        return {
          ...workspace,
          creditBalance: Number(settings.creditBalance ?? 0),
          plan: String(settings.plan ?? 'enterprise'),
        };
      }),
    };
  }),

  grantPersonalCredits: adminProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        note: z.string().max(500).optional(),
        user: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await resolveUser(ctx.serverDB, input.user);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Пользователь не найден' });

      const market = await getMarket(ctx.serverDB, target.id);
      const current = Number(market.personalCreditBalance ?? 0);
      const ledger = Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : [];
      const balance = current + input.amount;

      await saveMarket(ctx.serverDB, target.id, {
        ...market,
        personalCreditBalance: balance,
        personalCreditCurrency: 'internal',
        personalCreditLedger: [
          ...ledger,
          {
            actorUserId: ctx.userId,
            amount: input.amount,
            at: new Date().toISOString(),
            balanceAfter: balance,
            note: input.note,
            type: 'admin_grant',
          },
        ],
      });

      return { balance, userId: target.id };
    }),

  setWorkspaceFrozen: adminProcedure
    .input(
      z.object({
        frozen: z.boolean(),
        reason: z.string().max(500).optional(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .update(workspaces)
        .set({
          frozen: input.frozen,
          frozenAt: input.frozen ? new Date() : null,
          frozenReason: input.frozen ? input.reason : null,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, input.workspaceId));

      return { frozen: input.frozen };
    }),

  setWorkspacePlan: adminProcedure
    .input(z.object({ plan: planSchema, workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await updateWorkspaceSettings(ctx.serverDB, input.workspaceId, { plan: input.plan });
      return { plan: input.plan };
    }),

  topUpWorkspaceCredits: adminProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        note: z.string().max(500).optional(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await getWorkspaceSettings(ctx.serverDB, input.workspaceId);
      const current = Number(settings.creditBalance ?? 0);
      const ledger = Array.isArray(settings.creditLedger) ? settings.creditLedger : [];
      const balance = current + input.amount;

      await updateWorkspaceSettings(ctx.serverDB, input.workspaceId, {
        creditBalance: balance,
        creditCurrency: 'internal',
        creditLedger: [
          ...ledger,
          {
            actorUserId: ctx.userId,
            amount: input.amount,
            at: new Date().toISOString(),
            balanceAfter: balance,
            note: input.note,
            type: 'admin_top_up',
          },
        ],
      });

      return { balance };
    }),
});
