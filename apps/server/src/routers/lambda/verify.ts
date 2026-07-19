import { VerifySkill } from '@lobechat/builtin-skills';
import {
  normalizeVerifySurface,
  verifyRunScenarios,
  verifySurfaces,
  verifyVisibilities,
} from '@lobechat/const/verify';
import type { VerifyCheckItem, VerifyRunContext, VerifyRunScenario } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { LlmGenerationTracingModel } from '@/database/models/llmGenerationTracing';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyReportModel } from '@/database/models/verifyReport';
import { VerifyRubricModel } from '@/database/models/verifyRubric';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import {
  verifyCheckResults,
  verifyEvidence,
  verifyReports,
  verifyRuns,
} from '@/database/schemas/verify';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  AcceptanceService,
  createEvidenceFileResolver,
  finalizeVerifyRun,
  VerifyExecutorService,
  VerifyFeedbackService,
  VerifyPlanGeneratorService,
  VerifyReporterService,
} from '@/server/services/verify';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

/**
 * Skills that `verify.getSkillBundle` will materialize to a builder's disk via
 * `lh verify init`. Keyed by identifier; add future pullable skills here. The
 * portable verify skill lives in @lobechat/builtin-skills but is intentionally
 * NOT in its `builtinSkills` runtime array (kept out of the homogeneous agent
 * runtime / tool picker), so it is referenced directly here.
 */
const PULLABLE_SKILLS: Record<string, typeof VerifySkill> = {
  [VerifySkill.identifier]: VerifySkill,
};

const verifierTypeSchema = z.enum(['program', 'agent', 'llm']);
const onFailSchema = z.enum(['manual', 'auto_repair']);
const decisionSchema = z.enum(['accepted', 'rejected', 'overridden']);
const modelConfigSchema = z.object({ model: z.string(), provider: z.string() });
const verdictSchema = z.enum(['passed', 'failed', 'uncertain']);
const checkStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  // Verifier could not run (infra failure) — carries no verdict.
  'errored',
  'skipped',
]);
const runSourceSchema = z.enum(['agent', 'agent-testing']);
const evidenceTypeSchema = z.enum([
  'screenshot',
  'gif',
  'video',
  'text',
  'dom_snapshot',
  'transcript',
]);
const evidenceCapturedBySchema = z.enum(['agent-browser', 'cdp', 'cli', 'program', 'llm_judge']);
const toulminSchema = z.object({
  counterEvidence: z.string().optional(),
  evidence: z.string().optional(),
  limitation: z.string().optional(),
  reasoning: z.string().optional(),
});

/** Derive the lifecycle status from a verdict when the caller doesn't pin one. */
const statusForVerdict = (verdict: 'passed' | 'failed' | 'uncertain') =>
  verdict === 'passed' ? ('passed' as const) : ('failed' as const);

/** Run-policy knobs persisted on a rubric (see VerifyRubricConfig). */
const rubricConfigSchema = z.object({
  maxRepairRounds: z.number().int().min(0).max(5).optional(),
});

const checkItemSchema = z.object({
  category: z.string().optional(),
  description: z.string().optional(),
  id: z.string(),
  index: z.number(),
  onFail: onFailSchema,
  required: z.boolean(),
  sourceCriterionId: z.string().nullish(),
  sourceRubricId: z.string().nullish(),
  supersedes: z.array(z.string()).optional(),
  title: z.string(),
  verifierConfig: z.record(z.string(), z.unknown()),
  verifierType: verifierTypeSchema,
});

const verifyRunIdInputSchema = z.object({ verifyRunId: z.string() });
const omitUndefined = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;

// The scenario's context, rendered as the report's scope header. Shared by
// createRun and updateRun so a re-ingest can refresh the scope in place.
// Validated per scenario at the door (see `withScenarioContext`).
const webUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  });

const pullRequestContextSchema = z.object({
  number: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  url: webUrlSchema.optional(),
});

/**
 * A surface, canonicalized at the door.
 *
 * Not a bare `z.enum`: `lh` is installed independently of this server, so an
 * older CLI still posts the historical spellings — `electron` alone accounts for
 * most of the surfaces ever written. Rejecting those would break ingest for
 * every client that hasn't upgraded, to no benefit, since they name a surface we
 * can resolve. So known spellings are normalized (`electron` → `desktop`) and
 * only a value that names no surface at all is rejected — the column still ends
 * up with nothing but the closed set.
 */
const surfaceSchema = z.string().transform((value, ctx) => {
  const surface = normalizeVerifySurface(value);
  if (surface) return surface;

  ctx.addIssue({
    code: 'custom',
    message: `"${value}" is not a product surface. Expected one of: ${verifySurfaces.join(', ')}. A test kind ("unit", "backend") or a runtime mode ("packaged build") is not a surface.`,
  });
  return z.NEVER;
});

const codingRunContextSchema = z.object({
  branch: z.string().optional(),
  commit: z.string().optional(),
  entry: z.string().optional(),
  pullRequest: pullRequestContextSchema.optional(),
  surfaces: z.array(surfaceSchema).optional(),
  testedAt: z.string().optional(),
});

/**
 * Non-coding scenarios store the scope as an open bag. The known shapes live in
 * `@lobechat/types` (`VerifyRunContext`); the server deliberately does not
 * enumerate their fields, so a new scenario — or a new scope field on an
 * existing one — never requires a server redeploy. Only `coding` gets strict
 * validation, because its scope needs canonicalization at the door (surfaces).
 */
const genericRunContextSchema = z.record(z.string(), z.unknown());

const scenarioSchema = z.enum(verifyRunScenarios);

/**
 * Validate `context` by its sibling `scenario`. Absent scenario defaults to
 * `coding` (the legacy contract — an older `lh` posts a coding scope with no
 * scenario field), so callers setting a non-coding context MUST send `scenario`
 * in the same payload or the coding schema strips their fields. Applied as a
 * transform (not a plain union) for two reasons: the coding path canonicalizes
 * surfaces in place, and an ordered union of all-optional stripping objects
 * would silently swallow a non-coding scope into the first match.
 */
const withScenarioContext = <T extends { context?: unknown; scenario?: VerifyRunScenario }>(
  schema: z.ZodType<T>,
) =>
  schema.transform((value, ctx) => {
    if (value.context === undefined) return { ...value, context: undefined };

    const contextSchema =
      (value.scenario ?? 'coding') === 'coding' ? codingRunContextSchema : genericRunContextSchema;
    const parsed = contextSchema.safeParse(value.context);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: ['context', ...issue.path],
        });
      }
      return z.NEVER;
    }

    return { ...value, context: parsed.data as VerifyRunContext };
  });

const runMetadataSchema = z.record(z.string(), z.unknown());

const updateRunInputSchema = verifyRunIdInputSchema.extend({
  // Every field optional — a re-ingest may refresh only the context/goal while
  // keeping the original title, so nothing here is required.
  value: withScenarioContext(
    z.object({
      context: z.unknown().optional(),
      goal: z.string().optional(),
      metadata: runMetadataSchema.optional(),
      plan: z.array(checkItemSchema).optional(),
      scenario: scenarioSchema.optional(),
      title: z.string().trim().min(1).max(200).optional(),
    }),
  ),
});

// Cursor-paginated report list. `cursor` is the opaque token from the previous
// page's `nextCursor`; `q` filters by title (server-side, so it hits the whole
// history, not just the loaded page).
const listReportSummariesInputSchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    q: z.string().optional(),
  })
  .optional();

const uploadEvidenceInputSchema = z
  .object({
    capturedBy: evidenceCapturedBySchema.optional(),
    // Exactly one of `content` (inline text) or `fileId` (already-uploaded artifact).
    checkResultId: z.string(),
    content: z.string().min(1).optional(),
    description: z.string().optional(),
    fileId: z.string().min(1).optional(),
    metadata: z.unknown().optional(),
    type: evidenceTypeSchema,
  })
  .refine((data) => Boolean(data.content) !== Boolean(data.fileId), {
    message: 'Provide exactly one of `content` or `fileId`.',
  });

const verifyProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      criterionModel: new VerifyCriterionModel(ctx.serverDB, ctx.userId, workspaceId),
      evidenceModel: new VerifyEvidenceModel(ctx.serverDB, ctx.userId, workspaceId),
      executorService: new VerifyExecutorService(ctx.serverDB, ctx.userId, workspaceId),
      tracingModel: new LlmGenerationTracingModel(ctx.serverDB, ctx.userId, workspaceId),
      feedbackService: new VerifyFeedbackService(ctx.serverDB, ctx.userId, workspaceId),
      operationModel: new AgentOperationModel(ctx.serverDB, ctx.userId, workspaceId),
      planGenerator: new VerifyPlanGeneratorService(ctx.serverDB, ctx.userId, workspaceId),
      reportModel: new VerifyReportModel(ctx.serverDB, ctx.userId, workspaceId),
      reporterService: new VerifyReporterService(ctx.serverDB, ctx.userId, workspaceId),
      resultModel: new VerifyCheckResultModel(ctx.serverDB, ctx.userId, workspaceId),
      rubricModel: new VerifyRubricModel(ctx.serverDB, ctx.userId, workspaceId),
      runModel: new VerifyRunModel(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

// Writes: workspace mode requires at least the member role, gating viewers
// out (read-only role) while personal mode passes through unrestricted.
const verifyWriteProcedure = verifyProcedure.use(requireWorkspaceRoleWhenScoped('member'));

const publicVerifyReportProcedure = publicProcedure.use(serverDatabase);

const resolveVerifyRun = async (ctx: { runModel: VerifyRunModel }, verifyRunId: string) => {
  const run = await ctx.runModel.findById(verifyRunId);

  if (!run) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification run not found' });
  }

  return run;
};

const resolveCheckResult = async (
  ctx: { resultModel: VerifyCheckResultModel },
  checkResultId: string,
) => {
  const result = await ctx.resultModel.findById(checkResultId);

  if (!result) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification check result not found' });
  }

  return result;
};

/** Resolve a run from an Agent Run operation id — the handle a builder has in
 * the run-start gap, before any result rows (and thus checkResultIds) exist. */
const resolveRunByOperation = async (ctx: { runModel: VerifyRunModel }, operationId: string) => {
  const run = await ctx.runModel.findByOperation(operationId);

  if (!run) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No verification run for this operation' });
  }

  return run;
};

export const verifyRouter = router({
  // ---- criteria (reusable atomic standards) ----
  createCriterion: verifyWriteProcedure
    .input(
      z.object({
        documentId: z.string().optional(),
        onFail: onFailSchema.optional(),
        required: z.boolean().optional(),
        title: z.string(),
        verifierConfig: z.record(z.string(), z.unknown()).optional(),
        verifierType: verifierTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.criterionModel.create(input)),

  deleteCriterion: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.criterionModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!criterion) return;
      assertWorkspaceRowManageable(ctx, criterion.userId, 'verify criterion');
      return ctx.criterionModel.delete(input.id);
    }),

  listCriteria: verifyProcedure.query(async ({ ctx }) => ctx.criterionModel.query()),

  updateCriterion: verifyWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().nullish(),
          documentId: z.string().nullish(),
          onFail: onFailSchema.optional(),
          required: z.boolean().optional(),
          title: z.string().optional(),
          verifierConfig: z.record(z.string(), z.unknown()).optional(),
          verifierType: verifierTypeSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.criterionModel.findById(input.id);
      if (!criterion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification criterion not found' });
      }
      assertWorkspaceRowManageable(ctx, criterion.userId, 'verify criterion');
      return ctx.criterionModel.update(input.id, input.value);
    }),

  // ---- rubrics (named criteria groups) ----
  createRubric: verifyWriteProcedure
    .input(
      z.object({
        config: rubricConfigSchema.optional(),
        description: z.string().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.rubricModel.create(input)),

  deleteRubric: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!rubric) return;
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.delete(input.id);
    }),

  getRubric: verifyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.findById(input.id)),

  getRubricCriteria: verifyProcedure
    .input(z.object({ rubricId: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.getCriteria(input.rubricId)),

  listRubrics: verifyProcedure.query(async ({ ctx }) => ctx.rubricModel.query()),

  setRubricCriteria: verifyWriteProcedure
    .input(
      z.object({
        criteria: z.array(z.object({ criterionId: z.string(), sortOrder: z.number().optional() })),
        rubricId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.rubricId);
      if (!rubric) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification rubric not found' });
      }
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.setCriteria(input.rubricId, input.criteria);
    }),

  updateRubric: verifyWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          config: rubricConfigSchema.optional(),
          description: z.string().nullish(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.id);
      if (!rubric) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification rubric not found' });
      }
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.update(input.id, input.value);
    }),

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
        modelConfig: modelConfigSchema.optional(),
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
   * criteria for the user to review/edit. Traced (TRACING_SCENARIOS.VerifyPlanGen),
   * returns drafts only — nothing persisted, no operation needed.
   */
  generateCriteria: verifyWriteProcedure
    .input(
      z.object({
        context: z.string().optional(),
        goal: z.string().min(1),
        maxCriteria: z.number().int().min(1).max(8).optional(),
        modelConfig: modelConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.planGenerator.generateCriteria(input)),

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
   * identifier so `lh verify init` can materialize it into a builder's working
   * directory. Dynamic-by-design: the source is the server's deployed
   * `@lobechat/builtin-skills`, so updating the skill + redeploying reaches every
   * builder on the next pull — no CLI re-release. Auth-gated (verifyProcedure);
   * returns NOT_FOUND for any identifier not in the pullable registry.
   */
  getSkillBundle: verifyProcedure.input(z.object({ identifier: z.string() })).query(({ input }) => {
    const skill = PULLABLE_SKILLS[input.identifier];
    if (!skill)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `No pullable skill with identifier "${input.identifier}"`,
      });
    return {
      content: skill.content,
      files: Object.fromEntries(
        Object.entries(skill.resources ?? {}).map(([path, meta]) => [path, meta.content ?? '']),
      ),
      identifier: skill.identifier,
      name: skill.name,
    };
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

  // ---- ingest (standalone sessions: results / evidence / report, e.g. agent-testing) ----
  // A verification session that isn't a live Agent Run (no executor): an external
  // harness creates the run, ingests each check's verdict + evidence, and writes a
  // report — all keyed by verifyRunId.
  createRun: verifyWriteProcedure
    .input(
      withScenarioContext(
        z.object({
          // The active scenario's context, rendered as the report's scope header.
          context: z.unknown().optional(),
          goal: z.string().optional(),
          metadata: runMetadataSchema.optional(),
          operationId: z.string().optional(),
          // The checks the run set out to make, authored before it ran. Kept next
          // to the results so a planned-but-never-executed item stays visible.
          plan: z.array(checkItemSchema).optional(),
          scenario: scenarioSchema.optional(),
          source: runSourceSchema.optional(),
          title: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.runModel.create({
        context: input.context,
        goal: input.goal,
        metadata: input.metadata,
        operationId: input.operationId,
        plan: input.plan,
        scenario: input.scenario,
        source: input.source ?? 'agent-testing',
        title: input.title,
      }),
    ),

  getRun: verifyProcedure
    .input(verifyRunIdInputSchema)
    .query(async ({ ctx, input }) => ctx.runModel.findById(input.verifyRunId)),

  // Delete a whole verification session: the run row cascades to its check
  // results (→ their evidence) and its report via the schema FKs, so one delete
  // tears down the published bundle. Ownership-scoped: resolveVerifyRun 404s a
  // run that isn't the caller's before we touch it.
  deleteRun: verifyWriteProcedure.input(verifyRunIdInputSchema).mutation(async ({ ctx, input }) => {
    const run = await resolveVerifyRun(ctx, input.verifyRunId);
    assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

    await ctx.runModel.delete(run.id);
    return { id: run.id, success: true };
  }),

  listRuns: verifyProcedure.query(async ({ ctx }) => ctx.runModel.query()),

  listReportSummaries: verifyProcedure
    .input(listReportSummariesInputSchema)
    .query(async ({ ctx, input }) => {
      const { items: runs, nextCursor } = await ctx.runModel.queryPage({
        cursor: input?.cursor,
        limit: input?.limit,
        q: input?.q,
      });
      const reports = await Promise.all(runs.map((run) => ctx.reportModel.findByRun(run.id)));

      const items = runs.map((run, index) => {
        const report = reports[index];

        return {
          report: report
            ? {
                createdAt: report.createdAt,
                failedChecks: report.failedChecks,
                generatedAt: report.generatedAt,
                id: report.id,
                overallConfidence: report.overallConfidence,
                passedChecks: report.passedChecks,
                reviewedByUser: report.reviewedByUser,
                summary: report.summary,
                totalChecks: report.totalChecks,
                uncertainChecks: report.uncertainChecks,
                verdict: report.verdict,
                verifyRunId: report.verifyRunId,
              }
            : null,
          run,
        };
      });

      return { items, nextCursor };
    }),

  listResultsByRun: verifyProcedure.input(verifyRunIdInputSchema).query(async ({ ctx, input }) => {
    const run = await resolveVerifyRun(ctx, input.verifyRunId);
    return ctx.resultModel.listByRun(run.id);
  }),

  updateRun: verifyWriteProcedure.input(updateRunInputSchema).mutation(async ({ ctx, input }) => {
    const run = await resolveVerifyRun(ctx, input.verifyRunId);
    assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

    const updated = await ctx.runModel.update(
      run.id,
      omitUndefined({
        context: input.value.context,
        goal: input.value.goal,
        metadata: input.value.metadata,
        plan: input.value.plan,
        scenario: input.value.scenario,
        title: input.value.title,
      }),
    );
    return { data: updated, success: true };
  }),

  ingestResult: verifyWriteProcedure
    .input(
      z
        .object({
          checkItemId: z.string(),
          checkItemIndex: z.number().optional(),
          checkItemTitle: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          required: z.boolean().optional(),
          status: checkStatusSchema.optional(),
          // `.nullish()` (not `.optional()`) so a re-ingest can pass an explicit
          // `null` to CLEAR a prior suggestion/observation — `undefined` would be
          // dropped from the conflict UPDATE and leave the stale value on the row,
          // breaking the full-replace guarantee. See the ingest-report caller.
          suggestion: z.string().nullish(),
          toulmin: toulminSchema.nullish(),
          // Optional so an infra failure can be recorded as `status: 'errored'`
          // with no verdict (the verifier never produced a judgment).
          verdict: verdictSchema.optional(),
          verifierType: verifierTypeSchema.optional(),
          verifyRunId: z.string(),
        })
        // A row needs either a verdict (→ derives status) or an explicit status
        // (e.g. `errored`); otherwise there's nothing to record.
        .refine((v) => v.verdict !== undefined || v.status !== undefined, {
          message: 'Either a verdict or an explicit status is required.',
          path: ['verdict'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await resolveVerifyRun(ctx, input.verifyRunId);
      // The conflict-update overwrites the run's existing result rows.
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      return ctx.resultModel.upsertByCheckItem({
        checkItemId: input.checkItemId,
        checkItemIndex: input.checkItemIndex,
        checkItemTitle: input.checkItemTitle,
        completedAt: new Date(),
        confidence: input.confidence,
        required: input.required ?? true,
        // Prefer an explicit status; else derive from the verdict (the refine
        // guarantees at least one is present).
        status: input.status ?? (input.verdict ? statusForVerdict(input.verdict) : 'errored'),
        suggestion: input.suggestion,
        toulmin: input.toulmin,
        verdict: input.verdict,
        verifierType: input.verifierType ?? 'agent',
        verifyRunId: run.id,
      });
    }),

  // Prune one check result (ownership-scoped; its evidence cascades). The
  // re-ingest path calls this for cases a later report round dropped, so
  // updating a session in place stays a full replace and never accretes stale
  // checks. resolveCheckResult 404s a result that isn't the caller's.
  deleteResult: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.id);
      assertWorkspaceRowManageable(ctx, result.userId, 'verify result');

      await ctx.resultModel.delete(result.id);
      return { id: result.id, success: true };
    }),

  uploadEvidence: verifyWriteProcedure
    .input(uploadEvidenceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.checkResultId);
      // Attaching evidence mutates another member's result — creator-scoped,
      // mirroring submitCheckEvidence.
      assertWorkspaceRowManageable(ctx, result.userId, 'verify result');

      return ctx.evidenceModel.create({
        capturedAt: new Date(),
        capturedBy: input.capturedBy ?? null,
        checkResultId: result.id,
        content: input.content ?? null,
        description: input.description ?? null,
        fileId: input.fileId ?? null,
        metadata: input.metadata ?? null,
        type: input.type,
      });
    }),

  /**
   * Builder self-evidence contract: submit a check item's verdict AND its
   * evidence in one call. The check_result row is created lazily (idempotent
   * upsert on `(verifyRunId, checkItemId)`) so the builder doesn't need a
   * pre-existing `checkResultId` — solving the run-start handle gap. Evidence
   * is optional (attach mid-run) and verdict is optional (set later by review).
   */
  submitCheckEvidence: verifyWriteProcedure
    .input(
      z
        .object({
          checkItemId: z.string(),
          checkItemIndex: z.number().optional(),
          checkItemTitle: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          evidence: z
            .array(
              z
                .object({
                  capturedBy: evidenceCapturedBySchema.optional(),
                  content: z.string().min(1).optional(),
                  description: z.string().optional(),
                  fileId: z.string().min(1).optional(),
                  type: evidenceTypeSchema,
                })
                .refine((e) => Boolean(e.content) !== Boolean(e.fileId), {
                  message: 'Provide exactly one of `content` or `fileId`.',
                }),
            )
            .optional(),
          // The builder may hold only its Agent Run operationId (run-start gap);
          // either handle resolves the session.
          operationId: z.string().optional(),
          required: z.boolean().optional(),
          status: checkStatusSchema.optional(),
          suggestion: z.string().optional(),
          toulmin: toulminSchema.optional(),
          verdict: verdictSchema.optional(),
          verifierType: verifierTypeSchema.optional(),
          verifyRunId: z.string().optional(),
        })
        .refine((d) => Boolean(d.verifyRunId) || Boolean(d.operationId), {
          message: 'Provide either `verifyRunId` or `operationId`.',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = input.verifyRunId
        ? await resolveVerifyRun(ctx, input.verifyRunId)
        : await resolveRunByOperation(ctx, input.operationId!);
      // The idempotent upsert overwrites the run's existing result rows.
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      // `required` / `verifierType` / index / title are stable per plan item, so
      // hydrate them from the run plan rather than hardcoding defaults — otherwise
      // an evidence-only submit would flip a soft criterion to required:true on the
      // conflict-update. `status` is mutable lifecycle state: omit it when there's
      // no verdict so an existing row keeps its status (and a new row falls to the
      // DB default 'pending') instead of being reset to 'running'. drizzle omits
      // undefined fields from both the insert and the conflict-update.
      const planItem = (run.plan as VerifyCheckItem[] | null)?.find(
        (i) => i.id === input.checkItemId,
      );

      const checkResult = await ctx.resultModel.upsertByCheckItem({
        checkItemId: input.checkItemId,
        checkItemIndex: input.checkItemIndex ?? planItem?.index,
        checkItemTitle: input.checkItemTitle ?? planItem?.title,
        completedAt: input.verdict ? new Date() : undefined,
        confidence: input.confidence,
        required: input.required ?? planItem?.required,
        status: input.status ?? (input.verdict ? statusForVerdict(input.verdict) : undefined),
        suggestion: input.suggestion,
        toulmin: input.toulmin,
        verdict: input.verdict,
        verifierType: input.verifierType ?? planItem?.verifierType ?? 'agent',
        verifyRunId: run.id,
      });

      const evidence = input.evidence?.length
        ? await Promise.all(
            input.evidence.map((e) =>
              ctx.evidenceModel.create({
                capturedAt: new Date(),
                capturedBy: e.capturedBy ?? null,
                checkResultId: checkResult.id,
                content: e.content ?? null,
                description: e.description ?? null,
                fileId: e.fileId ?? null,
                type: e.type,
              }),
            ),
          )
        : [];

      return { checkResult, evidence };
    }),

  listEvidence: verifyProcedure
    .input(z.object({ checkResultId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await resolveCheckResult(ctx, input.checkResultId);
      return ctx.evidenceModel.listByCheckResult(result.id);
    }),

  deleteEvidence: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const evidence = await ctx.evidenceModel.findById(input.id);

      if (!evidence) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification evidence not found' });
      }
      assertWorkspaceRowManageable(ctx, evidence.userId, 'verify evidence');

      await ctx.evidenceModel.delete(evidence.id);
      return { id: evidence.id, success: true };
    }),

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

  /**
   * One-shot payload for the standalone report viewer: the session, its report,
   * and every check result with its evidence — addressed purely by verifyRunId
   * (no operation / chat context required).
   *
   * Public like the acceptance page: a `public` run's report URL is readable by
   * anyone holding the id; `private` stays gated to the owner and (for
   * workspace scope) workspace members. A denied read looks exactly like a
   * missing run (`null`) — existence must not leak. `isOwner` additionally
   * gates what only the author may see — today the origin conversation,
   * which is redacted for everyone else.
   */
  getReportBundle: publicVerifyReportProcedure
    .input(verifyRunIdInputSchema)
    .query(async ({ ctx, input }) => {
      const found = await ctx.serverDB.query.verifyRuns.findFirst({
        where: eq(verifyRuns.id, input.verifyRunId),
      });
      if (!found) return null;

      const isOwner = Boolean(ctx.userId) && ctx.userId === found.userId;
      let canRead = isOwner || found.visibility === 'public';
      if (!canRead && ctx.userId && found.workspaceId) {
        const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
          found.workspaceId,
          ctx.userId,
        );
        canRead = Boolean(member);
      }
      if (!canRead) return null;
      // `origin` points at the author's private topic/agent — never hand it to a
      // visitor holding nothing but the shared link.
      const { origin: _origin, ...publicMetadata } = found.metadata ?? {};
      const run =
        isOwner || !found.metadata?.origin ? found : { ...found, metadata: publicMetadata };
      const [report, results] = await Promise.all([
        ctx.serverDB.query.verifyReports.findFirst({
          where: eq(verifyReports.verifyRunId, input.verifyRunId),
        }),
        ctx.serverDB
          .select()
          .from(verifyCheckResults)
          .where(eq(verifyCheckResults.verifyRunId, input.verifyRunId))
          .orderBy(asc(verifyCheckResults.checkItemIndex)),
      ]);

      // Resolve display metadata for each file-backed evidence artifact.
      const resolveFileMeta = createEvidenceFileResolver(
        ctx.serverDB,
        run.userId,
        run.workspaceId ?? undefined,
      );

      const resultsWithEvidence = await Promise.all(
        results.map(async (r) => {
          const evidence = await ctx.serverDB
            .select()
            .from(verifyEvidence)
            .where(eq(verifyEvidence.checkResultId, r.id))
            .orderBy(asc(verifyEvidence.createdAt));
          return {
            ...r,
            evidence: await Promise.all(
              evidence.map(async (e) => ({ ...e, ...(await resolveFileMeta(e.fileId)) })),
            ),
          };
        }),
      );
      return { isOwner, report: report ?? null, results: resultsWithEvidence, run };
    }),
});
