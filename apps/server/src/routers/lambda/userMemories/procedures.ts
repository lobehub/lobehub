import { eq } from 'drizzle-orm';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  UserMemoryActivityModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { userSettings } from '@/database/schemas';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

export type MemoryEffort = 'high' | 'low' | 'medium';

export const normalizeMemoryEffort = (value: unknown): MemoryEffort => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

export const memoryProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const userSettingsRow = await ctx.serverDB.query.userSettings.findFirst({
    columns: { memory: true },
    where: eq(userSettings.id, ctx.userId),
  });
  const memoryConfig =
    typeof userSettingsRow?.memory === 'object' && userSettingsRow?.memory !== null
      ? (userSettingsRow.memory as { effort?: unknown })
      : undefined;
  const memoryEffort = normalizeMemoryEffort(memoryConfig?.effort);

  return opts.next({
    ctx: {
      activityModel: new UserMemoryActivityModel(ctx.serverDB, ctx.userId),
      experienceModel: new UserMemoryExperienceModel(ctx.serverDB, ctx.userId),
      identityModel: new UserMemoryIdentityModel(ctx.serverDB, ctx.userId),
      memoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId),
      memoryEffort,
    },
  });
});

export const memorySearchProcedure = memoryProcedure.use(async (opts) => {
  const { ctx } = opts;
  const ftsSearchRepo = await createFtsSearchRepo({
    db: ctx.serverDB,
    userId: ctx.userId,
    usage: 'memory',
  });

  return opts.next({
    ctx: {
      activityModel: new UserMemoryActivityModel(ctx.serverDB, ctx.userId, ftsSearchRepo),
      experienceModel: new UserMemoryExperienceModel(ctx.serverDB, ctx.userId, ftsSearchRepo),
      identityModel: new UserMemoryIdentityModel(ctx.serverDB, ctx.userId, ftsSearchRepo),
      memoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId, ftsSearchRepo),
    },
  });
});

export const memoryWriteProcedure = memoryProcedure.use(withScopedPermission('message:create'));
