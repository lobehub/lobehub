import { users } from '@/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, count, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const adminProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const [user] = await ctx.serverDB
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return next({ ctx });
});

export const adminRouter = router({
  listUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1),
        pageSize: z.number().int().min(1).max(100),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search } = input;
      const offset = (page - 1) * pageSize;

      const whereClause = search
        ? or(ilike(users.email, `%${search}%`), ilike(users.username, `%${search}%`))
        : undefined;

      const [items, [{ value: total }]] = await Promise.all([
        ctx.serverDB
          .select({
            banned: users.banned,
            createdAt: users.createdAt,
            displayName: users.fullName,
            email: users.email,
            id: users.id,
            role: users.role,
            username: users.username,
          })
          .from(users)
          .where(whereClause)
          .limit(pageSize)
          .offset(offset),
        ctx.serverDB.select({ value: count() }).from(users).where(whereClause),
      ]);

      return { items, total };
    }),

  updateUserRole: adminProcedure
    .input(z.object({ role: z.enum(['user', 'admin', 'pro']), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));
    }),

  banUser: adminProcedure
    .input(z.object({ banned: z.boolean(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .update(users)
        .set({ banned: input.banned })
        .where(eq(users.id, input.userId));
    }),

  getSystemStats: adminProcedure.query(async ({ ctx }) => {
    const [totalResult, bannedResult, adminResult] = await Promise.all([
      ctx.serverDB.select({ value: count() }).from(users),
      ctx.serverDB.select({ value: count() }).from(users).where(eq(users.banned, true)),
      ctx.serverDB.select({ value: count() }).from(users).where(eq(users.role, 'admin')),
    ]);

    return {
      adminUsers: adminResult[0].value,
      bannedUsers: bannedResult[0].value,
      totalUsers: totalResult[0].value,
    };
  }),

  listContent: adminProcedure
    .input(z.object({ page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100) }))
    .query(async () => {
      return { items: [], total: 0 };
    }),
});

export type AdminRouter = typeof adminRouter;
