import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalEnvironmentModel,
  AgentEvalExperimentModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { FileService } from '@/server/services/file';
import { FileUploadService } from '@/server/services/fileUpload';

export const agentEvalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      benchmarkModel: new AgentEvalBenchmarkModel(ctx.serverDB, ctx.userId, wsId),
      datasetModel: new AgentEvalDatasetModel(ctx.serverDB, ctx.userId, wsId),
      environmentModel: new AgentEvalEnvironmentModel(ctx.serverDB, ctx.userId, wsId),
      experimentModel: new AgentEvalExperimentModel(ctx.serverDB, ctx.userId, wsId),
      runModel: new AgentEvalRunModel(ctx.serverDB, ctx.userId, wsId),
      runService: new AgentEvalRunService(ctx.serverDB, ctx.userId, wsId),
      runTopicModel: new AgentEvalRunTopicModel(ctx.serverDB, ctx.userId, wsId),
      testCaseModel: new AgentEvalTestCaseModel(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      fileUploadService: new FileUploadService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Write variant for mutations — gates viewers out of all eval-creation/edit
// flows. Reads keep using `agentEvalProcedure` (viewers may inspect existing
// benchmarks / runs).
export const agentEvalProcedureWrite = agentEvalProcedure.use(withScopedPermission('agent:update'));
