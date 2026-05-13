import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { RunAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import {
  runAgentTrajectoryWorkflowConfig,
  runAgentTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runAgentTrajectory';

const nextHandler = serve<RunAgentTrajectoryPayload>(runAgentTrajectoryWorkflowHandler, {
  ...runAgentTrajectoryWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-run-agent-trajectory',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
