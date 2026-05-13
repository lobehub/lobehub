import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { ResumeAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';
import {
  resumeAgentTrajectoryWorkflowConfig,
  resumeAgentTrajectoryWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/resumeAgentTrajectory';

const nextHandler = serve<ResumeAgentTrajectoryPayload>(resumeAgentTrajectoryWorkflowHandler, {
  ...resumeAgentTrajectoryWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-resume-agent-trajectory',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
