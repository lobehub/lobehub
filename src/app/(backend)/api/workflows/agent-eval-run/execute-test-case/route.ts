import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { ExecuteTestCasePayload } from '@/server/workflows/agentEvalRun';
import {
  executeTestCaseWorkflowConfig,
  executeTestCaseWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/executeTestCase';

const nextHandler = serve<ExecuteTestCasePayload>(executeTestCaseWorkflowHandler, {
  ...executeTestCaseWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-execute-test-case',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
