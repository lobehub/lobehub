import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { departmentQuotas, users } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UsageRecordService } from '@/server/services/usage';

const usageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      usageRecordService: new UsageRecordService(ctx.serverDB, ctx.userId),
    },
  });
});

const adminUsageProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const user = await ctx.serverDB.query.users.findFirst({
    columns: { role: true },
    where: eq(users.id, ctx.userId),
  });
  if (user?.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return opts.next({
    ctx: {
      serverDB: ctx.serverDB,
      usageRecordService: new UsageRecordService(ctx.serverDB, ctx.userId),
    },
  });
});

export const usageRouter = router({
  adminFindAndGroupByDateRange: adminUsageProcedure
    .input(z.object({ endAt: z.string(), startAt: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAllAndGroupByDateRange(input.startAt, input.endAt);
    }),

  adminFindAndGroupByDay: adminUsageProcedure
    .input(z.object({ mo: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAllAndGroupByDay(input.mo);
    }),

  adminFindByMonth: adminUsageProcedure
    .input(z.object({ mo: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAllByMonth(input.mo);
    }),

  adminGetAllDepartmentQuotas: adminUsageProcedure.query(async ({ ctx }) => {
    return await ctx.serverDB.query.departmentQuotas.findMany();
  }),

  adminGetAllUserQuotas: adminUsageProcedure.query(async ({ ctx }) => {
    return await ctx.serverDB.query.users.findMany({
      columns: {
        dailyCostLimit: true,
        dailyTokenLimit: true,
        email: true,
        fullName: true,
        id: true,
        interests: true,
        monthlyCostLimit: true,
        monthlyTokenLimit: true,
      },
    });
  }),

  adminGetUsageByDepartment: adminUsageProcedure
    .input(z.object({ mo: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAllByDepartment(input.mo);
    }),

  adminSetDepartmentQuota: adminUsageProcedure
    .input(
      z.object({
        dailyCostLimit: z.string().nullable(),
        dailyTokenLimit: z.number().int().nullable(),
        department: z.string(),
        monthlyCostLimit: z.string().nullable(),
        monthlyTokenLimit: z.number().int().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { department, ...limits } = input;
      await ctx.serverDB
        .insert(departmentQuotas)
        .values({ department, ...limits })
        .onConflictDoUpdate({ set: limits, target: departmentQuotas.department });
    }),

  adminSetUserQuota: adminUsageProcedure
    .input(
      z.object({
        dailyCostLimit: z.string().nullable(),
        dailyTokenLimit: z.number().int().nullable(),
        monthlyCostLimit: z.string().nullable(),
        monthlyTokenLimit: z.number().int().nullable(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, ...limits } = input;
      await ctx.serverDB.update(users).set(limits).where(eq(users.id, userId));
    }),

  isAdmin: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    const user = await ctx.serverDB.query.users.findFirst({
      columns: { role: true },
      where: eq(users.id, ctx.userId),
    });
    return user?.role === 'admin';
  }),

  checkQuota: usageProcedure.query(async ({ ctx }) => {
    return await ctx.usageRecordService.checkQuota();
  }),

  findAndGroupByDateRange: usageProcedure
    .input(
      z.object({
        endAt: z.string(),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDateRange(input.startAt, input.endAt);
    }),

  findAndGroupByDay: usageProcedure
    .input(
      z.object({
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDay(input.mo);
    }),

  findByMonth: usageProcedure
    .input(
      z.object({
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findByMonth(input.mo);
    }),
});
