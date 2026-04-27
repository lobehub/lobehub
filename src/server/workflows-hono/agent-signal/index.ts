import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal';
import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/run',
  serve<AgentSignalWorkflowRunPayload>((context) => runAgentSignalWorkflow(context), {
    qstashClient: createWorkflowQstashClient(),
  }),
);

export default app;
