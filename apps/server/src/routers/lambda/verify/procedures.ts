import { TRPCError } from '@trpc/server';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { LlmGenerationTracingModel } from '@/database/models/llmGenerationTracing';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyReportModel } from '@/database/models/verifyReport';
import { VerifyRubricModel } from '@/database/models/verifyRubric';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalCriteriaGeneratorService } from '@/server/services/goal/criteriaGenerator';
import {
  VerifyExecutorService,
  VerifyFeedbackService,
  VerifyPlanGeneratorService,
  VerifyReporterService,
} from '@/server/services/verify';

export const verifyProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      criterionModel: new VerifyCriterionModel(ctx.serverDB, ctx.userId, workspaceId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, workspaceId),
      evidenceModel: new VerifyEvidenceModel(ctx.serverDB, ctx.userId, workspaceId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, workspaceId),
      executorService: new VerifyExecutorService(ctx.serverDB, ctx.userId, workspaceId),
      tracingModel: new LlmGenerationTracingModel(ctx.serverDB, ctx.userId, workspaceId),
      feedbackService: new VerifyFeedbackService(ctx.serverDB, ctx.userId, workspaceId),
      goalCriteriaGenerator: new GoalCriteriaGeneratorService(
        ctx.serverDB,
        ctx.userId,
        workspaceId,
      ),
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
export const verifyWriteProcedure = verifyProcedure.use(requireWorkspaceRoleWhenScoped('member'));

export const resolveVerifyRun = async (ctx: { runModel: VerifyRunModel }, verifyRunId: string) => {
  const run = await ctx.runModel.findById(verifyRunId);

  if (!run) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification run not found' });
  }

  return run;
};

export const resolveCheckResult = async (
  ctx: { resultModel: VerifyCheckResultModel },
  checkResultId: string,
) => {
  const result = await ctx.resultModel.findById(checkResultId);

  if (!result) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification check result not found' });
  }

  return result;
};

/**
 * A run's operation token (`heteroOperationScope`, let through by
 * `authorizeHeteroOperationEvidence`) reaches only the round of the operation
 * it was minted for. A user session passes through.
 */
export const assertOperationInScope = (
  ctx: { heteroOperationScope?: string },
  operationId: string | null | undefined,
) => {
  if (ctx.heteroOperationScope && operationId !== ctx.heteroOperationScope) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "This run's token can only reach its own verification round",
    });
  }
};

/**
 * Fields a builder may send under its run's operation token: which check the
 * evidence answers, the evidence itself, and the observation it shows. The
 * verdict, status, confidence, required-ness, verifier, title, index,
 * suggestion and Toulmin judgement belong to the round's independent verifier.
 */
const OPERATION_TOKEN_SUBMIT_FIELDS = new Set([
  'checkItemId',
  'evidence',
  'operationId',
  'toulmin',
  'verifyRunId',
]);

/**
 * Refuse a run's operation token any result-authoring field on
 * `submitCheckEvidence`, so the Task cannot judge its own check before the
 * verifier does. A user session passes through.
 */
export const assertEvidenceOnlySubmission = (
  ctx: { heteroOperationScope?: string },
  input: Record<string, unknown> & { toulmin?: Record<string, unknown> },
) => {
  if (!ctx.heteroOperationScope) return;

  const authored = [
    ...Object.keys(input).filter(
      (key) => input[key] !== undefined && !OPERATION_TOKEN_SUBMIT_FIELDS.has(key),
    ),
    ...Object.keys(input.toulmin ?? {})
      .filter((key) => input.toulmin![key] !== undefined && key !== 'evidence')
      .map((key) => `toulmin.${key}`),
  ];
  if (authored.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `This run's token submits evidence only; the verifier sets ${authored.join(', ')}`,
    });
  }
};
