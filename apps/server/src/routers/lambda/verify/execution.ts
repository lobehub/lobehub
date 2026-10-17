import { fetchAcceptanceSkillBundle } from '@lobechat/builtin-skills/acceptance';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure } from '@/libs/trpc/lambda';
import { markSilentTRPCErrorLog } from '@/libs/trpc/utils/errorLogger';
import { finalizeVerifyRun } from '@/server/services/verify';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { resolveCheckResult, verifyProcedure, verifyWriteProcedure } from './procedures';
import { checkItemSchema, modelConfigSchema, onFailSchema, verifierTypeSchema } from './schemas';

const decisionSchema = z.enum(['accepted', 'rejected', 'overridden']);

export const executionProcedures = {
  // ---- per-run plan ----
  confirmPlan: verifyWriteProcedure
    .input(z.object({ operationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.runModel.ensureForOperation(input.operationId);
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      return ctx.runModel.confirmPlan(run.id);
    }),
  generateDraftPlan: verifyWriteProcedure
    .input(
      z.object({
        context: z.string().optional(),
        enableAiGeneration: z.boolean().optional(),
        goal: z.string(),
        maxAiCriteria: z.number().optional(),
        operationId: z.string(),
        verifyCriteriaIds: z.array(z.string()).optional(),
        verifyRubricId: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The generator ends with setPlan() on the operation's run — resolve it
      // and gate on the run owner before writing (same as confirmPlan).
      const run = await ctx.runModel.ensureForOperation(input.operationId);
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      return ctx.planGenerator.generateDraftPlan(input);
    }),
  /**
   * Config-time: turn a one-sentence acceptance requirement into proposed
   * criteria for the user to review/edit. Traced (TRACING_SCENARIOS.GoalCriteriaGen),
   * returns drafts only — nothing persisted, no operation needed.
   */
  generateCriteria: verifyWriteProcedure
    .input(
      z.object({
        context: z.string().optional(),
        goal: z.string().min(1),
        maxCriteria: z.number().int().min(1).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.planGenerator.generateCriteria(input);
      } catch (error) {
        const errorType = (error as { errorType?: unknown } | null)?.errorType;
        if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
          const trpcError = new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: AgentRuntimeErrorType.InvalidProviderAPIKey,
          });
          // Runtime errors are plain payloads, so tRPC normalizes them into an Error cause.
          // Mark the normalized cause that the shared handler actually receives.
          markSilentTRPCErrorLog(trpcError.cause);
          throw trpcError;
        }

        throw error;
      }
    }),
  /** Draft the standing acceptance contract for the create-goal flow. */
  generateGoalCriteria: verifyWriteProcedure
    .input(
      z.object({
        context: z.string().optional(),
        goal: z.string().min(1),
        maxCriteria: z.number().int().min(1).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.goalCriteriaGenerator.generate(input);
      } catch (error) {
        const errorType = (error as { errorType?: unknown } | null)?.errorType;
        if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
          const trpcError = new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: AgentRuntimeErrorType.InvalidProviderAPIKey,
          });
          markSilentTRPCErrorLog(trpcError.cause);
          throw trpcError;
        }

        throw error;
      }
    }),
  /** Draft the generated goal title, instruction, and standing acceptance contract. */
  generateGoalPlan: verifyWriteProcedure
    .input(
      z.object({
        context: z.string().optional(),
        goal: z.string().min(1),
        maxCriteria: z.number().int().min(1).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.goalCriteriaGenerator.generatePlan(input);
      } catch (error) {
        const errorType = (error as { errorType?: unknown } | null)?.errorType;
        if (errorType === AgentRuntimeErrorType.InvalidProviderAPIKey) {
          const trpcError = new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message: AgentRuntimeErrorType.InvalidProviderAPIKey,
          });
          markSilentTRPCErrorLog(trpcError.cause);
          throw trpcError;
        }

        throw error;
      }
    }),
  /** Persist (user-edited) drafts as standalone criteria; returns their ids in order. */
  createCriteria: verifyWriteProcedure
    .input(
      z.object({
        drafts: z.array(
          z.object({
            description: z.string().optional(),
            documentId: z.string().nullable().optional(),
            instruction: z.string().optional(),
            onFail: onFailSchema.optional(),
            required: z.boolean().optional(),
            title: z.string().min(1),
            verifierConfig: z.record(z.string(), z.unknown()).optional(),
            verifierType: verifierTypeSchema.optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.planGenerator.createCriteriaFromDrafts(input.drafts)),
  getVerifierThread: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Resolve an agent verifier's sub-run to the thread it ran in, so the
      // client can open that execution trace in the portal.
      const op = await ctx.operationModel.findById(input.operationId);
      if (!op) return null;
      return { threadId: op.threadId ?? null, topicId: op.topicId ?? null };
    }),
  getVerifierTracing: verifyProcedure
    .input(z.object({ tracingId: z.string() }))
    .query(async ({ ctx, input }) => {
      // The model / token / latency of an LLM verifier's judgment, surfaced in
      // the result detail panel.
      const row = await ctx.tracingModel.findById(input.tracingId);
      if (!row) return null;
      return {
        inputTokens: row.inputTokens ?? null,
        latencyMs: row.latencyMs ?? null,
        model: row.model ?? null,
        outputTokens: row.outputTokens ?? null,
        provider: row.provider ?? null,
      };
    }),
  /**
   * Serve a pullable skill bundle (`SKILL.md` + inline resource files) by
   * identifier without authentication. Keep the legacy alias while sourcing
   * all installers from the upstream default branch (or an explicitly selected tag).
   */
  getSkillBundle: publicProcedure
    .input(
      z.object({
        identifier: z.string(),
        version: z
          .string()
          .regex(/^v?\d+\.\d+\.\d+$/)
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      if (input.identifier !== 'acceptance' && input.identifier !== 'verify')
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No pullable skill with identifier "${input.identifier}"`,
        });
      return fetchAcceptanceSkillBundle(input.version);
    }),
  getVerifyState: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ ctx, input }) => ctx.runModel.getStateByOperation(input.operationId)),
  skipPlan: verifyWriteProcedure
    .input(z.object({ operationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.runModel.findByOperation(input.operationId);
      if (!run) return;
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      await ctx.runModel.updateStatus(run.id, null);
    }),
  updateDraftItems: verifyWriteProcedure
    .input(z.object({ items: z.array(checkItemSchema), operationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.runModel.ensureForOperation(input.operationId);
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');
      return ctx.runModel.replacePlanItems(run.id, input.items);
    }),
  // ---- results / execution ----
  executeVerify: verifyWriteProcedure
    .input(
      z.object({
        batchLlm: z.boolean().optional(),
        deliverable: z.string(),
        goal: z.string(),
        modelConfig: modelConfigSchema,
        operationId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Execution writes verdicts onto the run's result rows — only the run
      // creator (or a workspace owner) may drive another member's session.
      const existingRun = await ctx.runModel.findByOperation(input.operationId);
      if (existingRun) assertWorkspaceRowManageable(ctx, existingRun.userId, 'verify run');

      await ctx.executorService.execute(input);
      // Settle the run through the SAME finalizer the completion-time gate uses
      // (runVerifyOnCompletion → finalizeVerifyRun): repair-aware tail (spawn a
      // repair round on auto_repair failures), then report + drive the bound task.
      // Without this, a verify triggered via the CLI (`lh verify run`, e.g. a
      // device/agent-testing run) would write verdicts and stop — never auto-repair.
      await finalizeVerifyRun(
        ctx.serverDB,
        ctx.userId,
        input.operationId,
        {
          report: {
            deliverable: input.deliverable,
            goal: input.goal,
            modelConfig: input.modelConfig,
          },
        },
        ctx.workspaceId ?? undefined,
      );
      const run = await ctx.runModel.findByOperation(input.operationId);
      return run ? ctx.resultModel.listByRun(run.id) : [];
    }),
  listResults: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.runModel.findByOperation(input.operationId);
      return run ? ctx.resultModel.listByRun(run.id) : [];
    }),
  // ---- feedback (data flywheel) ----
  submitDecision: verifyWriteProcedure
    .input(z.object({ decision: decisionSchema, resultId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.resultId);
      assertWorkspaceRowManageable(ctx, result.userId, 'verify result');
      return ctx.feedbackService.submitDecision(result.id, input.decision);
    }),
};
