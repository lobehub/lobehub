import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { RunThreadTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import {
  runThreadTrajectoryWorkflowConfig,
  runThreadTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/runThreadTrajectory';

const nextHandler = serve<RunThreadTrajectoryPayload>(runThreadTrajectoryWorkflowHandler, {
  ...runThreadTrajectoryWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-run-thread-trajectory',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
