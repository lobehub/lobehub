import { serve } from '@upstash/workflow/nextjs';

import { qstashClient } from '@/libs/qstash';
import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal';
import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';

/**
 * Runs one normalized Agent Signal source event inside Upstash Workflow.
 *
 * Use when:
 * - Agent Signal ingress accepts an event and needs async policy execution
 * - debounce/throttle guards must survive across workflow invocations
 *
 * Expects:
 * - `requestPayload` contains one normalized source event plus the owning `userId`
 *
 * Returns:
 * - A small execution summary for workflow logs and inspection
 */
export const { POST } = serve<AgentSignalWorkflowRunPayload>(
  async (context) => runAgentSignalWorkflow(context),
  {
    qstashClient,
  },
);
