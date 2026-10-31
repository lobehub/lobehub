import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GoalModel } from '@/database/models/goal';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { GoalSubscriptionService } from '@/server/services/goal/subscriptions';

/** Procedures and helpers shared by `goalRouter` and its spread-in procedure groups. */
export const goalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      goalModel: new GoalModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
      goalService: new GoalService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
      goalSubscriptionService: new GoalSubscriptionService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
export const goalWriteProcedure = goalProcedure.use(withScopedPermission('agent:update'));
export const idInput = z.object({ id: z.string() });

export function mapGoalError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  console.error(`[goal:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} goal`,
  });
}
