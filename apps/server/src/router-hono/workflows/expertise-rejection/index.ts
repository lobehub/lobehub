import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { runExpertiseRejectionWorkflow } from '@/server/workflows/expertiseRejection';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/run',
  serve(
    withOtelMetricsForUpstashWorkflows(runExpertiseRejectionWorkflow, {
      url: '/api/workflows/expertise-rejection/run',
    }),
    { qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
