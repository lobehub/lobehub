import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { RunBenchmarkPayload } from '@/server/workflows/agentEvalRun';
import {
  runBenchmarkWorkflowConfig,
  runBenchmarkWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runBenchmark';

const nextHandler = serve<RunBenchmarkPayload>(runBenchmarkWorkflowHandler, {
  ...runBenchmarkWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-run-benchmark',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
