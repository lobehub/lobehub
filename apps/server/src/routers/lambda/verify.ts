import { z } from 'zod';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { LlmGenerationTracingModel } from '@/database/models/llmGenerationTracing';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { VerifyRubricModel } from '@/database/models/verifyRubric';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  VerifyExecutorService,
  VerifyFeedbackService,
  VerifyPlanGeneratorService,
} from '@/server/services/verify';

const verifierTypeSchema = z.enum(['program', 'agent', 'llm']);
const onFailSchema = z.enum(['manual', 'auto_repair']);
const decisionSchema = z.enum(['accepted', 'rejected', 'overridden']);
const modelConfigSchema = z.object({ model: z.string(), provider: z.string() });

/** Run-policy knobs persisted on a rubric (see VerifyRubricConfig). */
const rubricConfigSchema = z.object({
  maxRepairRounds: z.number().int().min(0).max(5).optional(),
});

const checkItemSchema = z.object({
  id: z.string(),
  index: z.number(),
  onFail: onFailSchema,
  required: z.boolean(),
  sourceCriterionId: z.string().nullable().optional(),
  sourceRubricId: z.string().nullable().optional(),
  title: z.string(),
  verifierConfig: z.record(z.unknown()),
  verifierType: verifierTypeSchema,
});

const verifyProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      criterionModel: new VerifyCriterionModel(ctx.serverDB, ctx.userId),
      executorService: new VerifyExecutorService(ctx.serverDB, ctx.userId),
      tracingModel: new LlmGenerationTracingModel(ctx.serverDB, ctx.userId),
      feedbackService: new VerifyFeedbackService(ctx.serverDB, ctx.userId),
      operationModel: new AgentOperationModel(ctx.serverDB, ctx.userId),
      planGenerator: new VerifyPlanGeneratorService(ctx.serverDB, ctx.userId),
      resultModel: new VerifyCheckResultModel(ctx.serverDB, ctx.userId),
      rubricModel: new VerifyRubricModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const verifyRouter = router({
  // ---- criteria (reusable atomic standards) ----
  createCriterion: verifyProcedure
    .input(
      z.object({
        documentId: z.string().optional(),
        onFail: onFailSchema.optional(),
        required: z.boolean().optional(),
        title: z.string(),
        verifierConfig: z.record(z.unknown()).optional(),
        verifierType: verifierTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.criterionModel.create(input)),

  deleteCriterion: verifyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.criterionModel.delete(input.id)),

  listCriteria: verifyProcedure.query(async ({ ctx }) => ctx.criterionModel.query()),

  updateCriterion: verifyProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().nullable().optional(),
          documentId: z.string().nullable().optional(),
          onFail: onFailSchema.optional(),
          required: z.boolean().optional(),
          title: z.string().optional(),
          verifierConfig: z.record(z.unknown()).optional(),
          verifierType: verifierTypeSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.criterionModel.update(input.id, input.value)),

  // ---- rubrics (named criteria groups) ----
  createRubric: verifyProcedure
    .input(
      z.object({
        config: rubricConfigSchema.optional(),
        description: z.string().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.rubricModel.create(input)),

  deleteRubric: verifyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.rubricModel.delete(input.id)),

  getRubric: verifyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.findById(input.id)),

  getRubricCriteria: verifyProcedure
    .input(z.object({ rubricId: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.getCriteria(input.rubricId)),

  listRubrics: verifyProcedure.query(async ({ ctx }) => ctx.rubricModel.query()),

  setRubricCriteria: verifyProcedure
    .input(
      z.object({
        criteria: z.array(z.object({ criterionId: z.string(), sortOrder: z.number().optional() })),
        rubricId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.rubricModel.setCriteria(input.rubricId, input.criteria),
    ),

  updateRubric: verifyProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          config: rubricConfigSchema.optional(),
          description: z.string().nullable().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.rubricModel.update(input.id, input.value)),

  // ---- per-run plan ----
  confirmPlan: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .mutation(async ({ ctx, input }) => ctx.operationModel.confirmVerifyPlan(input.operationId)),

  generateDraftPlan: verifyProcedure
    .input(
      z.object({
        context: z.string().optional(),
        enableAiGeneration: z.boolean().optional(),
        goal: z.string(),
        maxAiCriteria: z.number().optional(),
        modelConfig: modelConfigSchema.optional(),
        operationId: z.string(),
        verifyCriteriaIds: z.array(z.string()).optional(),
        verifyRubricId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.planGenerator.generateDraftPlan(input)),

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

  getVerifyState: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ ctx, input }) => ctx.operationModel.getVerifyState(input.operationId)),

  skipPlan: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .mutation(async ({ ctx, input }) =>
      ctx.operationModel.updateVerifyStatus(input.operationId, null),
    ),

  updateDraftItems: verifyProcedure
    .input(z.object({ items: z.array(checkItemSchema), operationId: z.string() }))
    .mutation(async ({ ctx, input }) =>
      ctx.operationModel.replaceVerifyPlanItems(input.operationId, input.items),
    ),

  // ---- results / execution ----
  executeVerify: verifyProcedure
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
      await ctx.executorService.execute(input);
      return ctx.resultModel.listByOperation(input.operationId);
    }),

  listResults: verifyProcedure
    .input(z.object({ operationId: z.string() }))
    .query(async ({ ctx, input }) => ctx.resultModel.listByOperation(input.operationId)),

  // ---- feedback (data flywheel) ----
  submitDecision: verifyProcedure
    .input(z.object({ decision: decisionSchema, resultId: z.string() }))
    .mutation(async ({ ctx, input }) =>
      ctx.feedbackService.submitDecision(input.resultId, input.decision),
    ),
});
