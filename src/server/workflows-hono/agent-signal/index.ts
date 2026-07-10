import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';
import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal/types';

import { qstashAuth } from '../middlewares/qstashAuth';
import { createWorkflowQstashClient } from '../qstashClient';
import { scheduleNightlyReview } from './handlers/scheduleNightlyReview';

const app = new Hono();

app.post('/cron-hourly-nightly-self-review', qstashAuth(), scheduleNightlyReview);

app.post(
  '/run',
  serve<AgentSignalWorkflowRunPayload>(
    withOtelMetricsForUpstashWorkflows((context) => runAgentSignalWorkflow(context), {
      url: '/api/workflows/agent-signal/run',
    }),
    {
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

export default app;
