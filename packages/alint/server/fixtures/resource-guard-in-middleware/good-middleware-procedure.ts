import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { acceptanceWriteProcedure, resolveAcceptanceForWrite } from './procedures';

/** Resolves and authorizes the addressed acceptance once; handlers read it from ctx. */
const acceptanceByIdProcedure = acceptanceWriteProcedure
  .input(z.object({ id: z.string().uuid() }))
  .use(async ({ ctx, input, next }) => {
    const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
    return next({ ctx: { acceptance, acceptanceService: service } });
  });

export const flowRouter = router({
  publishFlow: acceptanceByIdProcedure
    .input(z.object({ definition: z.unknown() }))
    .mutation(({ ctx, input }) =>
      ctx.acceptanceService.publishFlow(ctx.acceptance.id, input.definition),
    ),
  deleteFlow: acceptanceByIdProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.acceptanceService.deleteFlow(ctx.acceptance.id, input.flowId),
    ),
  archive: acceptanceByIdProcedure.mutation(({ ctx }) =>
    ctx.acceptanceService.archive(ctx.acceptance.id),
  ),
  // Two resources in one call: keeps the explicit resolution.
  merge: acceptanceWriteProcedure
    .input(z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance: source, service } = await resolveAcceptanceForWrite(ctx, input.sourceId);
      const { acceptance: target } = await resolveAcceptanceForWrite(ctx, input.targetId);
      return service.merge(source.id, target.id);
    }),
});
