import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { qstashClient } from '@/libs/qstash';

import { onThreadComplete } from './handlers/onThreadComplete';
import { onTrajectoryComplete } from './handlers/onTrajectoryComplete';
import {
  executeTestCaseHandler,
  executeTestCaseWorkflowOptions,
} from './workflows/executeTestCase';
import { finalizeRunHandler, finalizeRunWorkflowOptions } from './workflows/finalizeRun';
import {
  paginateTestCasesHandler,
  paginateTestCasesWorkflowOptions,
} from './workflows/paginateTestCases';
import {
  resumeAgentTrajectoryHandler,
  resumeAgentTrajectoryWorkflowOptions,
} from './workflows/resumeAgentTrajectory';
import {
  resumeThreadTrajectoryHandler,
  resumeThreadTrajectoryWorkflowOptions,
} from './workflows/resumeThreadTrajectory';
import {
  runAgentTrajectoryHandler,
  runAgentTrajectoryWorkflowOptions,
} from './workflows/runAgentTrajectory';
import { runBenchmarkHandler, runBenchmarkWorkflowOptions } from './workflows/runBenchmark';
import {
  runThreadTrajectoryHandler,
  runThreadTrajectoryWorkflowOptions,
} from './workflows/runThreadTrajectory';

const app = new Hono();

app.post(
  '/run-benchmark',
  serve(
    withOtelMetricsForUpstashWorkflows(runBenchmarkHandler, {
      url: '/api/workflows/agent-eval-run/run-benchmark',
    }),
    { ...runBenchmarkWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/paginate-test-cases',
  serve(
    withOtelMetricsForUpstashWorkflows(paginateTestCasesHandler, {
      url: '/api/workflows/agent-eval-run/paginate-test-cases',
    }),
    { ...paginateTestCasesWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/execute-test-case',
  serve(
    withOtelMetricsForUpstashWorkflows(executeTestCaseHandler, {
      url: '/api/workflows/agent-eval-run/execute-test-case',
    }),
    { ...executeTestCaseWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/run-agent-trajectory',
  serve(
    withOtelMetricsForUpstashWorkflows(runAgentTrajectoryHandler, {
      url: '/api/workflows/agent-eval-run/run-agent-trajectory',
    }),
    { ...runAgentTrajectoryWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/run-thread-trajectory',
  serve(
    withOtelMetricsForUpstashWorkflows(runThreadTrajectoryHandler, {
      url: '/api/workflows/agent-eval-run/run-thread-trajectory',
    }),
    { ...runThreadTrajectoryWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/resume-agent-trajectory',
  serve(
    withOtelMetricsForUpstashWorkflows(resumeAgentTrajectoryHandler, {
      url: '/api/workflows/agent-eval-run/resume-agent-trajectory',
    }),
    { ...resumeAgentTrajectoryWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/resume-thread-trajectory',
  serve(
    withOtelMetricsForUpstashWorkflows(resumeThreadTrajectoryHandler, {
      url: '/api/workflows/agent-eval-run/resume-thread-trajectory',
    }),
    { ...resumeThreadTrajectoryWorkflowOptions, qstashClient },
  ),
);

app.post(
  '/finalize-run',
  serve(
    withOtelMetricsForUpstashWorkflows(finalizeRunHandler, {
      url: '/api/workflows/agent-eval-run/finalize-run',
    }),
    { ...finalizeRunWorkflowOptions, qstashClient },
  ),
);

// Plain completion webhooks posted by AgentRuntimeService — not Upstash workflows.
app.post('/on-trajectory-complete', onTrajectoryComplete);
app.post('/on-thread-complete', onThreadComplete);

export default app;
