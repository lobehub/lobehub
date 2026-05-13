import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import type { PaginateTestCasesPayload } from '@/server/workflows/agentEvalRun';
import {
  paginateTestCasesWorkflowConfig,
  paginateTestCasesWorkflowHandler,
} from '@/server/workflows/agentEvalRun/handlers/paginateTestCases';

const nextHandler = serve<PaginateTestCasesPayload>(paginateTestCasesWorkflowHandler, {
  ...paginateTestCasesWorkflowConfig,
  qstashClient,
});

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-paginate-test-cases',
  nextHandler.POST,
  { honoRuntime: 'root' },
);
