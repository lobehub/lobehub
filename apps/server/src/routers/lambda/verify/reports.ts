import { verifyVisibilities } from '@lobechat/const/verify';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { AcceptanceService } from '@/server/services/verify';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { resolveVerifyRun, verifyProcedure, verifyWriteProcedure } from './procedures';
import { modelConfigSchema, verdictSchema, verifyRunIdInputSchema } from './schemas';

export const reportsRouter = router({
  upsertReport: verifyWriteProcedure
    .input(
      z.object({
        content: z.string().optional(),
        failedChecks: z.number().optional(),
        generatedBy: z.string().optional(),
        overallConfidence: z.number().min(0).max(1).optional(),
        passedChecks: z.number().optional(),
        summary: z.string().optional(),
        totalChecks: z.number().optional(),
        uncertainChecks: z.number().optional(),
        verdict: verdictSchema.optional(),
        verifyRunId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await resolveVerifyRun(ctx, input.verifyRunId);
      // The upsert overwrites the run's existing report row.
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      const report = await ctx.reportModel.upsertByRun({
        content: input.content ?? null,
        failedChecks: input.failedChecks ?? null,
        generatedBy: input.generatedBy ?? 'agent-testing',
        overallConfidence: input.overallConfidence ?? null,
        passedChecks: input.passedChecks ?? null,
        summary: input.summary ?? null,
        totalChecks: input.totalChecks ?? null,
        uncertainChecks: input.uncertainChecks ?? null,
        verdict: input.verdict ?? null,
        verifyRunId: run.id,
      });

      // A published report settles an ingested round — re-derive the aggregate
      // it chains onto (→ `delivered`, awaiting the user's decision). Best-effort:
      // the report write must not fail on a rollup hiccup.
      if (run.acceptanceId) {
        try {
          await new AcceptanceService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ).recomputeStatus(run.acceptanceId);
        } catch (error) {
          console.error('[verify:upsertReport:recomputeAcceptance]', error);
        }
      }

      return report;
    }),
  getReport: verifyProcedure.input(verifyRunIdInputSchema).query(async ({ ctx, input }) => {
    const run = await resolveVerifyRun(ctx, input.verifyRunId);
    return ctx.reportModel.findByRun(run.id);
  }),
  /**
   * Server-side LLM report: generate the narrative from the session's results +
   * evidence (verdict / stats computed deterministically). Distinct from
   * `upsertReport`, which stores a report a standalone harness computed itself.
   */
  regenerateReport: verifyWriteProcedure
    .input(
      z.object({
        deliverable: z.string(),
        goal: z.string(),
        modelConfig: modelConfigSchema,
        verifyRunId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await resolveVerifyRun(ctx, input.verifyRunId);
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      return ctx.reporterService.generateReport({
        deliverable: input.deliverable,
        goal: input.goal,
        modelConfig: input.modelConfig,
        verifyRunId: run.id,
      });
    }),
  /**
   * Flip who can read this round's report page beyond its creator. Creation
   * defaults are scope-dependent (personal → public, workspace → private) and
   * acceptance-attached rounds inherit their aggregate; this is the deliberate
   * per-round override. Note `acceptance.setVisibility` cascades over rounds,
   * so the aggregate flip wins over earlier per-round choices.
   */
  setRunVisibility: verifyWriteProcedure
    .input(z.object({ verifyRunId: z.string(), visibility: z.enum(verifyVisibilities) }))
    .mutation(async ({ ctx, input }) => {
      const run = await resolveVerifyRun(ctx, input.verifyRunId);
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      await ctx.runModel.setVisibility(run.id, input.visibility);
    }),
});
