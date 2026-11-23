import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

const replayTargetSchema = z.object({
  model: z.string().trim().min(1),
  provider: z.string().trim().min(1),
});

/** Frozen-call replay: freeze a real LLM call into a case and re-issue it across models. */
export const replayRouter = router({
  /**
   * Freeze the LLM call behind an assistant message into a test case: copies
   * the exact request out of the operation trace and records where it came
   * from. `criteria` must be self-contained — the judge only ever sees it plus
   * the case input, the replayed output and `expected`.
   */
  freezeTestCaseFromMessage: agentEvalProcedureWrite
    .input(
      z.object({
        capturedOutputKind: z.enum(['negative', 'positive']).optional(),
        criteria: z.string().trim().min(1),
        datasetId: z.string(),
        expected: z.string().optional(),
        messageId: z.string(),
        stepIndex: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.replayService.freezeFromMessage(input)),

  /**
   * Have a model draft the self-contained criteria for freezing a message.
   * Saves nothing — the user edits the draft and confirms through
   * `freezeTestCaseFromMessage`.
   */
  draftTestCaseCriteria: agentEvalProcedureWrite
    .input(
      z.object({
        capturedOutputKind: z.enum(['negative', 'positive']).optional(),
        locale: z.string().optional(),
        messageId: z.string(),
        note: z.string().max(2000).optional(),
        stepIndex: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.replayService.draftCriteria(input)),

  /**
   * Re-issue every frozen case of a dataset (or the given cases) against 1–8
   * models and judge each output. Returns at once; cells fill in via workflow.
   */
  startReplayComparison: agentEvalProcedureWrite
    .input(
      z.object({
        datasetId: z.string(),
        judge: replayTargetSchema.optional(),
        name: z.string().optional(),
        passThreshold: z.number().min(0).max(1).optional(),
        replayOptions: z
          .object({
            maxTokens: z.number().int().positive().optional(),
            temperature: z.number().min(0).max(2).optional(),
            withTools: z.boolean().optional(),
          })
          .optional(),
        targets: z.array(replayTargetSchema).min(1).max(8),
        testCaseIds: z.array(z.string()).min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.replayService.startComparison(input)),

  retryReplayComparisonErrors: agentEvalProcedureWrite
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.replayService.retryErroredCells(input.runId)),

  getReplayComparison: agentEvalProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => ctx.replayService.getComparison(input.runId)),

  listReplayComparisonsByTestCase: agentEvalProcedure
    .input(z.object({ testCaseId: z.string() }))
    .query(async ({ ctx, input }) => ctx.replayService.listComparisonsByTestCase(input.testCaseId)),
});
