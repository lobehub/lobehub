import { devicePoolMatrixSchema, devicePoolPolicySchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DevicePoolAccessError, DevicePoolModel } from '@/database/models/devicePool';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DevicePoolAccessService } from '@/server/services/deviceGateway/poolAccess';

const scopeInput = z.object({ scope: z.enum(['personal', 'workspace']) });
const poolInput = scopeInput.extend({ id: z.string().min(1).max(100) });
const poolProcedure = wsCompatProcedure
  .use(serverDatabase)
  .input(scopeInput)
  .use(async (opts) => {
    const { ctx, input } = opts;
    if (!(await new DevicePoolAccessService(ctx.serverDB, ctx.userId).isEnabled())) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Enable Device pools in Labs first' });
    }
    if (input.scope === 'workspace' && !ctx.workspaceId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace context required' });
    }
    const result = await opts.next({
      ctx: {
        devicePoolModel: new DevicePoolModel(
          ctx.serverDB,
          ctx.userId,
          input.scope === 'workspace' ? (ctx.workspaceId ?? undefined) : undefined,
        ),
      },
    });
    if (!result.ok && result.error.cause instanceof DevicePoolAccessError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: result.error.cause.message });
    }
    return result;
  });

/**
 * Exposes scoped device-pool configuration without granting execution from client-supplied identities.
 *
 * Use when:
 * - Device settings or Agent pool permissions load and save configuration
 *
 * Expects:
 * - Authenticated context; only pool owners may edit policy in this version
 *
 * Returns:
 * - Scoped resources or explicit authorization errors
 *
 * Call stack:
 * devicePoolService -> devicePoolRouter -> {@link DevicePoolModel}
 *
 * Triggering workflow:
 * devicePoolService -> devicePoolRouter -> pool configuration -> DevicePoolModel
 */
export const devicePoolRouter = router({
  addDevice: poolProcedure
    .input(poolInput.extend({ deviceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.devicePoolModel.addDevice(input.id, input.deviceId);
    }),
  create: poolProcedure
    .input(scopeInput.extend({ name: z.string().trim().min(1).max(100) }))
    .mutation(({ ctx, input }) => ctx.devicePoolModel.create(input.name)),
  detail: poolProcedure
    .input(poolInput)
    .query(({ ctx, input }) => ctx.devicePoolModel.detail(input.id)),
  list: poolProcedure.query(({ ctx }) => ctx.devicePoolModel.list()),
  remove: poolProcedure
    .input(poolInput)
    .mutation(({ ctx, input }) => ctx.devicePoolModel.remove(input.id)),
  removeDevice: poolProcedure
    .input(poolInput.extend({ deviceId: z.uuid() }))
    .mutation(({ ctx, input }) => ctx.devicePoolModel.removeDevice(input.id, input.deviceId)),
  saveOverride: poolProcedure
    .input(
      poolInput.extend({ agentId: z.string().min(1), rules: devicePoolMatrixSchema.nullable() }),
    )
    .mutation(({ ctx, input }) =>
      ctx.devicePoolModel.saveOverride(input.id, input.agentId, input.rules),
    ),
  update: poolProcedure
    .input(
      poolInput
        .extend({
          name: z.string().trim().min(1).max(100).optional(),
          policy: devicePoolPolicySchema.optional(),
        })
        .refine((input) => input.name !== undefined || input.policy !== undefined),
    )
    .mutation(({ ctx, input }) =>
      ctx.devicePoolModel.update(input.id, { name: input.name, policy: input.policy }),
    ),
});
