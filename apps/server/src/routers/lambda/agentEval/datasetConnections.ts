import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentEvalDatasetWriteError } from '@/database/models/agentEval/datasetAccess';
import { AgentEvalDatasetPackageImportError } from '@/database/repositories/agentEvalDatasetPackage';
import { router } from '@/libs/trpc/lambda';

import { validateEvalConnectorBindings } from './connectorBindings';
import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import { evalConnectorBindingsSchema } from './schemas';

const mapBindingError = (error: unknown): never => {
  if (error instanceof AgentEvalDatasetWriteError)
    throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
  if (error instanceof AgentEvalDatasetPackageImportError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  throw error;
};

export const datasetConnectionRouter = router({
  getDatasetConnectorBindings: agentEvalProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.datasetConnectorRepo.getBindings(input.datasetId);
      } catch (error) {
        return mapBindingError(error);
      }
    }),
  updateDatasetConnectorBindings: agentEvalProcedureWrite
    .input(
      z.object({
        caseBindings: z.record(z.string(), evalConnectorBindingsSchema).optional(),
        datasetId: z.string(),
        environmentBindings: z.record(z.string(), evalConnectorBindingsSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (Object.keys(input.caseBindings ?? {}).length > 0)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Mock connections belong to an Environment. Choose them for the Environment, not for a case.',
        });
      for (const bindings of Object.values(input.environmentBindings ?? {}))
        await validateEvalConnectorBindings(
          ctx.evalConnectorServiceForDataset,
          bindings,
          input.datasetId,
        );
      try {
        return await ctx.datasetConnectorRepo.updateBindings(input.datasetId, input);
      } catch (error) {
        return mapBindingError(error);
      }
    }),
});
