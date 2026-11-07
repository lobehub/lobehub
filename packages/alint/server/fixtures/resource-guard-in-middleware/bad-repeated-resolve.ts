import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { acceptanceWriteProcedure, resolveAcceptanceForWrite } from './procedures';

export const flowRouter = router({
  publishFlow: acceptanceWriteProcedure
    .input(z.object({ definition: z.unknown(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // alint-expect
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      return service.publishFlow(acceptance.id, input.definition);
    }),
  deleteFlow: acceptanceWriteProcedure
    .input(z.object({ flowId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      await service.deleteFlow(acceptance.id, input.flowId);
      return service.recomputeStatus(acceptance.id);
    }),
  reorderFlows: acceptanceWriteProcedure
    .input(z.object({ id: z.string().uuid(), order: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      return service.reorderFlows(acceptance.id, input.order);
    }),
  archive: acceptanceWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      return ctx.acceptanceService.archive(acceptance.id);
    }),
});
