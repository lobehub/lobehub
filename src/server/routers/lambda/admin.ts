import { adminApiKeys, adminAuditLogs, featureFlags, users } from '@/database/schemas';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const adminProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const [user] = await ctx.serverDB
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  if (!user || user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  return next({ ctx: { ...ctx, adminEmail: user.email } });
});

async function writeAuditLog(
  db: any,
  adminId: string,
  adminEmail: string | null | undefined,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
) {
  await db
    .insert(adminAuditLogs)
    .values({ adminId, adminEmail, action, targetType, targetId, metadata })
    .catch(() => null);
}

export const adminRouter = router({
  // ─── Users ─────────────────────────────────────────────────────────────────

  listUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        search: z.string().optional(),
        role: z.enum(['user', 'admin', 'pro']).optional(),
        banned: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, role, banned } = input;
      const offset = (page - 1) * pageSize;

      const conditions = [];
      if (search) {
        conditions.push(
          or(
            ilike(users.email, `%${search}%`),
            ilike(users.username, `%${search}%`),
            ilike(users.fullName, `%${search}%`),
          ),
        );
      }
      if (role) conditions.push(eq(users.role, role));
      if (banned !== undefined) conditions.push(eq(users.banned, banned));
      const whereClause = conditions.length > 0 ? and(...(conditions as [any, ...any[]])) : undefined;

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
          .orderBy(desc(users.createdAt))
          .limit(pageSize)
          .offset(offset),
        ctx.serverDB.select({ value: count() }).from(users).where(whereClause),
      ]);

      return { items, total };
    }),

  updateUserRole: adminProcedure
    .input(z.object({ role: z.enum(['user', 'admin', 'pro']), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [prev] = await ctx.serverDB
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      await ctx.serverDB
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));

      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'user.role_update', 'user', input.userId, { from: prev?.role, to: input.role });
    }),

  banUser: adminProcedure
    .input(z.object({ banned: z.boolean(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .update(users)
        .set({ banned: input.banned })
        .where(eq(users.id, input.userId));

      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, input.banned ? 'user.ban' : 'user.unban', 'user', input.userId);
    }),

  getSystemStats: adminProcedure.query(async ({ ctx }) => {
    const [totalResult, bannedResult, adminResult, proResult] = await Promise.all([
      ctx.serverDB.select({ value: count() }).from(users),
      ctx.serverDB.select({ value: count() }).from(users).where(eq(users.banned, true)),
      ctx.serverDB.select({ value: count() }).from(users).where(eq(users.role, 'admin')),
      ctx.serverDB.select({ value: count() }).from(users).where(eq(users.role, 'pro')),
    ]);

    return {
      adminUsers: adminResult[0].value,
      bannedUsers: bannedResult[0].value,
      proUsers: proResult[0].value,
      totalUsers: totalResult[0].value,
    };
  }),

  // ─── Feature Flags ─────────────────────────────────────────────────────────

  listFeatureFlags: adminProcedure.query(async ({ ctx }) => {
    return ctx.serverDB.select().from(featureFlags).orderBy(featureFlags.key);
  }),

  upsertFeatureFlag: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        defaultEnabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .insert(featureFlags)
        .values({ key: input.key, label: input.label, description: input.description, defaultEnabled: input.defaultEnabled })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { label: input.label, description: input.description, defaultEnabled: input.defaultEnabled, updatedAt: new Date() },
        });
      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'flag.upsert', 'flag', input.key, input as any);
    }),

  deleteFeatureFlag: adminProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.delete(featureFlags).where(eq(featureFlags.key, input.key));
      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'flag.delete', 'flag', input.key);
    }),

  setUserFlagOverride: adminProcedure
    .input(
      z.object({
        flagKey: z.string(),
        userId: z.string(),
        enabled: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [flag] = await ctx.serverDB
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, input.flagKey))
        .limit(1);

      if (!flag) throw new TRPCError({ code: 'NOT_FOUND' });

      const enabledIds = ((flag.enabledUserIds as string[]) ?? []).filter((id) => id !== input.userId);
      const disabledIds = ((flag.disabledUserIds as string[]) ?? []).filter((id) => id !== input.userId);

      await ctx.serverDB
        .update(featureFlags)
        .set({
          enabledUserIds: input.enabled === true ? [...enabledIds, input.userId] : enabledIds,
          disabledUserIds: input.enabled === false ? [...disabledIds, input.userId] : disabledIds,
          updatedAt: new Date(),
        })
        .where(eq(featureFlags.key, input.flagKey));

      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'flag.user_override', 'flag', input.flagKey, { userId: input.userId, enabled: input.enabled });
    }),

  // ─── Audit Logs ───────────────────────────────────────────────────────────

  listAuditLogs: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        action: z.string().optional(),
        adminId: z.string().optional(),
        targetId: z.string().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, action, adminId, targetId, from, to } = input;
      const offset = (page - 1) * pageSize;

      const conditions = [];
      if (action) conditions.push(ilike(adminAuditLogs.action, `%${action}%`));
      if (adminId) conditions.push(eq(adminAuditLogs.adminId, adminId));
      if (targetId) conditions.push(eq(adminAuditLogs.targetId, targetId));
      if (from) conditions.push(gte(adminAuditLogs.createdAt, new Date(from)));
      if (to) conditions.push(lte(adminAuditLogs.createdAt, new Date(to)));
      const whereClause = conditions.length > 0 ? and(...(conditions as [any, ...any[]])) : undefined;

      const [items, [{ value: total }]] = await Promise.all([
        ctx.serverDB
          .select()
          .from(adminAuditLogs)
          .where(whereClause)
          .orderBy(desc(adminAuditLogs.createdAt))
          .limit(pageSize)
          .offset(offset),
        ctx.serverDB.select({ value: count() }).from(adminAuditLogs).where(whereClause),
      ]);

      return { items, total };
    }),

  // ─── API Keys ─────────────────────────────────────────────────────────────

  listApiKeys: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.serverDB.select().from(adminApiKeys).orderBy(adminApiKeys.service);
    return rows.map((r) => ({
      ...r,
      keyValue: r.keyValue ? `${r.keyValue.slice(0, 8)}${'•'.repeat(16)}` : '',
    }));
  }),

  upsertApiKey: adminProcedure
    .input(
      z.object({
        service: z.string().min(1),
        label: z.string().min(1),
        keyValue: z.string().min(1),
        isActive: z.boolean().default(true),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .insert(adminApiKeys)
        .values({ service: input.service, label: input.label, keyValue: input.keyValue, isActive: input.isActive, config: input.config })
        .onConflictDoUpdate({
          target: adminApiKeys.service,
          set: { label: input.label, keyValue: input.keyValue, isActive: input.isActive, config: input.config, updatedAt: new Date() },
        });
      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'apikey.upsert', 'apikey', input.service, { service: input.service, label: input.label });
    }),

  toggleApiKey: adminProcedure
    .input(z.object({ service: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB
        .update(adminApiKeys)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(adminApiKeys.service, input.service));
      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, input.isActive ? 'apikey.enable' : 'apikey.disable', 'apikey', input.service);
    }),

  deleteApiKey: adminProcedure
    .input(z.object({ service: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.serverDB.delete(adminApiKeys).where(eq(adminApiKeys.service, input.service));
      await writeAuditLog(ctx.serverDB, ctx.userId, ctx.adminEmail, 'apikey.delete', 'apikey', input.service);
    }),

  listContent: adminProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }))
    .query(async () => ({ items: [], total: 0 })),
});

export type AdminRouter = typeof adminRouter;
