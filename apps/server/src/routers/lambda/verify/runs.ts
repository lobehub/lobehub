import { normalizeVerifySurface, verifyRunScenarios, verifySurfaces } from '@lobechat/const/verify';
import type { VerifyRunContext, VerifyRunScenario } from '@lobechat/types';
import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import { purgeVerifyRun } from '@/server/services/verify';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import {
  assertOperationInScope,
  resolveVerifyRun,
  verifyProcedure,
  verifyWriteProcedure,
} from './procedures';
import { checkItemSchema, verifyRunIdInputSchema } from './schemas';

const runSourceSchema = z.enum(['agent', 'agent-testing']);

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

// A report-summary page holds up to `limit` runs; cap the per-run report reads.
const REPORT_LOAD_CONCURRENCY = 5;

export const runsRouter = router({
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
  getRun: verifyProcedure.input(verifyRunIdInputSchema).query(async ({ ctx, input }) => {
    const run = await ctx.runModel.findById(input.verifyRunId);
    if (run) assertOperationInScope(ctx, run.operationId);
    return run;
  }),
  // Delete a whole verification session: the run row cascades to its check
  // results (→ their evidence) and its report via the schema FKs, and the
  // evidence files only this run referenced are purged from storage.
  // Ownership-scoped: resolveVerifyRun 404s a run that isn't the caller's
  // before we touch it.
  deleteRun: verifyWriteProcedure.input(verifyRunIdInputSchema).mutation(async ({ ctx, input }) => {
    const run = await resolveVerifyRun(ctx, input.verifyRunId);
    assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

    await purgeVerifyRun(
      ctx.serverDB,
      new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      run.userId,
      run.workspaceId ?? undefined,
      run.id,
    );
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
      const reports = await pMap(runs, (run) => ctx.reportModel.findByRun(run.id), {
        concurrency: REPORT_LOAD_CONCURRENCY,
      });

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
});
