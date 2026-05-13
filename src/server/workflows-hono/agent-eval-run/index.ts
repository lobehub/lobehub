import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import type {
  ExecuteTestCasePayload,
  FinalizeRunPayload,
  PaginateTestCasesPayload,
  ResumeAgentTrajectoryPayload,
  ResumeThreadTrajectoryPayload,
  RunAgentTrajectoryPayload,
  RunBenchmarkPayload,
  RunThreadTrajectoryPayload,
} from '@/server/workflows/agentEvalRun';
import {
  executeTestCaseWorkflowConfig,
  executeTestCaseWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/executeTestCase';
import {
  finalizeRunWorkflowConfig,
  finalizeRunWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/finalizeRun';
import {
  paginateTestCasesWorkflowConfig,
  paginateTestCasesWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/paginateTestCases';
import {
  resumeAgentTrajectoryWorkflowConfig,
  resumeAgentTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/resumeAgentTrajectory';
import {
  resumeThreadTrajectoryWorkflowConfig,
  resumeThreadTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/resumeThreadTrajectory';
import {
  runAgentTrajectoryWorkflowConfig,
  runAgentTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runAgentTrajectory';
import {
  runBenchmarkWorkflowConfig,
  runBenchmarkWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runBenchmark';
import {
  runThreadTrajectoryWorkflowConfig,
  runThreadTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runThreadTrajectory';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/execute-test-case',
  serve<ExecuteTestCasePayload>(executeTestCaseWorkflowHandler, {
    ...executeTestCaseWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/finalize-run',
  serve<FinalizeRunPayload>(finalizeRunWorkflowHandler, {
    ...finalizeRunWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/paginate-test-cases',
  serve<PaginateTestCasesPayload>(paginateTestCasesWorkflowHandler, {
    ...paginateTestCasesWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/resume-agent-trajectory',
  serve<ResumeAgentTrajectoryPayload>(resumeAgentTrajectoryWorkflowHandler, {
    ...resumeAgentTrajectoryWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/resume-thread-trajectory',
  serve<ResumeThreadTrajectoryPayload>(resumeThreadTrajectoryWorkflowHandler, {
    ...resumeThreadTrajectoryWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/run-agent-trajectory',
  serve<RunAgentTrajectoryPayload>(runAgentTrajectoryWorkflowHandler, {
    ...runAgentTrajectoryWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/run-benchmark',
  serve<RunBenchmarkPayload>(runBenchmarkWorkflowHandler, {
    ...runBenchmarkWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/run-thread-trajectory',
  serve<RunThreadTrajectoryPayload>(runThreadTrajectoryWorkflowHandler, {
    ...runThreadTrajectoryWorkflowConfig,
    qstashClient: createWorkflowQstashClient(),
  }),
);

export default app;
