import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { z } from 'zod';

import { AcceptanceFlowModel } from '@/database/models/acceptanceFlow';
import { router } from '@/libs/trpc/lambda';

import { acceptanceWriteProcedure, resolveAcceptanceForWrite } from './procedures';
import { reviewAnnotationsSchema } from './schemas';

const flowDefinitionSchema = z.object({
  title: z.string().min(1).max(200),
  entryNodeId: z.string().uuid(),
  nodes: z
    .array(
      z.object({
        id: z.string().uuid(),
        criterionId: z.string().uuid().optional(),
        subFlowId: z.string().uuid().optional(),
        check: z
          .object({
            id: z.string().uuid(),
            title: z.string().min(1).max(200),
            description: z.string().optional(),
            definition: verifyCheckDefinitionSchema,
          })
          .optional(),
        overrides: z
          .object({
            required: z.boolean().optional(),
            onFail: z.enum(['manual', 'auto_repair']).optional(),
            fixtureData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(100),
  edges: z
    .array(
      z.object({
        id: z.string().uuid(),
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
        trigger: z.string().min(1).max(1000),
        condition: z.string().max(2000).optional(),
        required: z.boolean(),
      }),
    )
    .max(300),
});

export const flowRouter = router({
  publishFlow: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        definition: flowDefinitionSchema,
        flowId: z.string().uuid().optional(),
        expectedHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      return new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).publish(
        input.id,
        input.definition,
        input.flowId,
        input.expectedHash,
      );
    }),
  deleteFlow: acceptanceWriteProcedure
    .input(z.object({ id: z.string().uuid(), flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      const result = await new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).delete(
        input.id,
        input.flowId,
      );
      await service.recomputeStatus(input.id);
      return result;
    }),
  startFlow: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        flowId: z.string().uuid(),
        sourceRunId: z.string().uuid().optional(),
        verifyRunId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      const result = await new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).start(
        input.id,
        input.flowId,
        input.verifyRunId,
        input.sourceRunId,
      );
      await service.recomputeStatus(input.id);
      return result;
    }),
  recordFlowStep: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        verifyRunId: z.string().uuid(),
        checkItemId: z.string().min(1),
        observation: z.string().min(1).max(20000),
        verdict: z.enum(['passed', 'failed', 'uncertain', 'blocked']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      return new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).record(input.id, input);
    }),
  completeFlow: acceptanceWriteProcedure
    .input(z.object({ id: z.string().uuid(), verifyRunId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      const result = await new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).complete(
        input.id,
        input.verifyRunId,
      );
      await service.recomputeStatus(input.id);
      return result;
    }),
  reviewFlowStep: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        attemptId: z.string().uuid(),
        review: z.enum(['accepted', 'rejected']),
        comment: z.string().max(4000),
        annotations: reviewAnnotationsSchema,
        fileIds: z.array(z.string()).max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      return new AcceptanceFlowModel(ctx.serverDB, acceptance.userId).review(
        input.id,
        input.attemptId,
        input.review,
        input.comment,
        ctx.userId,
        { annotations: input.annotations, fileIds: input.fileIds },
      );
    }),
});
