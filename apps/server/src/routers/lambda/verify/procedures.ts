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
