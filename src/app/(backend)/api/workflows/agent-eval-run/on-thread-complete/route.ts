import { agentEvalRunOnThreadCompleteAPIHandler } from '@/server/api-runtime/agentEvalRunWorkflow';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const POST = createNextAPIRouteHandler(
  'api-workflows-agent-eval-run-on-thread-complete',
  agentEvalRunOnThreadCompleteAPIHandler,
  { honoRuntime: 'root' },
);
