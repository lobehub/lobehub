import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { runExpertiseHistoryWorkflow } from '@/server/workflows/expertiseHistory';
import { runExpertiseHistoryTopicWorkflow } from '@/server/workflows/expertiseHistory/topic';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/run',
  serve(
    withOtelMetricsForUpstashWorkflows(runExpertiseHistoryWorkflow, {
      url: '/api/workflows/expertise-history/run',
    }),
    { qstashClient: createWorkflowQstashClient() },
  ),
);

app.post(
  '/topic',
  serve(
    withOtelMetricsForUpstashWorkflows(runExpertiseHistoryTopicWorkflow, {
      url: '/api/workflows/expertise-history/topic',
    }),
    { qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
