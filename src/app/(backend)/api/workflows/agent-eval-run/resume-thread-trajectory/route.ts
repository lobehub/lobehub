import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { ResumeThreadTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import {
  resumeThreadTrajectoryWorkflowConfig,
  resumeThreadTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/resumeThreadTrajectory';

const nextHandler = serve<ResumeThreadTrajectoryPayload>(resumeThreadTrajectoryWorkflowHandler, {
  ...resumeThreadTrajectoryWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-resume-thread-trajectory',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
