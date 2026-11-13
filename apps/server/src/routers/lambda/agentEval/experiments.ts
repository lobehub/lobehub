import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { RUN_ENRICHMENT_CONCURRENCY } from './constants';
import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

/** Run statuses that still have work in flight; such an experiment is stopped before it is deleted. */
const ACTIVE_RUN_STATUSES = new Set(['pending', 'running']);

export const experimentRouter = router({
  // ============================================
  // Experiment Operations
  // ============================================
  createExperiment: agentEvalProcedureWrite
    .input(
      z.object({
        // Optional caller-supplied id for cross-server idempotent creation.
        id: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        benchmarkIds: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.experimentModel.create(input);
      return { data, success: true };
    }),
  listExperiments: agentEvalProcedure.query(async ({ ctx }) => {
    const data = await ctx.experimentModel.query();
    return { data, success: true };
  }),
  getExperiment: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const experiment = await ctx.experimentModel.findById(input.id);
      if (!experiment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Experiment not found' });
      }

      // Enrich runs with target agent display info (batched) and dataset name
      // (mapped from the datasets already fetched — no extra queries).
      const agentIds = [
        ...new Set(experiment.runs.map((run) => run.targetAgentId).filter(Boolean)),
      ] as string[];
      const agents = await pMap(agentIds, (id) => ctx.runService.getAgentDisplayInfo(id), {
        concurrency: RUN_ENRICHMENT_CONCURRENCY,
      });
      const agentMap = Object.fromEntries(agents.filter(Boolean).map((a) => [a!.id, a!]));
      const datasetNameMap = new Map(experiment.datasets.map((d) => [d.id, d.name]));

      const runs = experiment.runs.map((run) => ({
        ...run,
        datasetName: datasetNameMap.get(run.datasetId) || undefined,
        targetAgent: run.targetAgentId ? agentMap[run.targetAgentId] : undefined,
      }));

      return { data: { ...experiment, runs }, success: true };
    }),
  updateExperiment: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        benchmarkIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await ctx.experimentModel.update(id, data);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Experiment not found' });
      }
      return { data: result, success: true };
    }),
  deleteExperiment: agentEvalProcedureWrite
    .input(
      z.object({
        id: z.string(),
        // Lobe Bench: an experiment owns its runs, so deleting it deletes them too (results,
        // topics and case Agents go with each run) instead of detaching them like the Lab does.
        withRuns: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.withRuns) {
          const runs = await ctx.runModel.query({ experimentId: input.id });
          if (runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
            return { success: false, error: 'Stop the experiment before deleting it' };
          }
          await pMap(runs, (run) => ctx.runService.deleteRun(run.id), { concurrency: 4 });
        }
        const result = await ctx.experimentModel.delete(input.id);
        if (result.rowCount === 0) {
          return { success: false, error: 'Experiment not found' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete experiment',
        };
      }
    }),
});
