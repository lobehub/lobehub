import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { FinalizeRunPayload } from '@/server/workflows/agentEvalRun';
import {
  finalizeRunWorkflowConfig,
  finalizeRunWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/finalizeRun';

const nextHandler = serve<FinalizeRunPayload>(finalizeRunWorkflowHandler, {
  ...finalizeRunWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-finalize-run',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
