import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';
import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal/types';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/run',
  serve<AgentSignalWorkflowRunPayload>((context) => runAgentSignalWorkflow(context), {
    qstashClient: createWorkflowQstashClient(),
  }),
);

export default app;
