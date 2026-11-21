import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { resolveCheckResult, verifyProcedure } from './procedures';

export const ingestRouter = router({
  deleteResult: verifyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.id);
      return ctx.resultModel.delete(result.id);
    }),
  uploadEvidence: verifyProcedure
    .input(z.object({ checkResultId: z.string(), key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.checkResultId);
      return ctx.evidenceModel.create(result.id, input.key);
    }),
  listEvidence: verifyProcedure
    .input(z.object({ resultId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.resultId);
      return ctx.evidenceModel.list(result.id);
    }),
  refreshQuota: verifyProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.workspaceId) await resolveCheckResult(ctx, input.deviceId);
      return ctx.quotaService.refresh(input.deviceId);
    }),
});
