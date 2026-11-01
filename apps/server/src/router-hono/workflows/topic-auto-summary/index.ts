import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { createWorkflowQstashClient } from '../qstashClient';
import { dispatchTopicAutoSummary, dispatchTopicAutoSummaryOptions } from './dispatch';
import { executeTopicAutoSummary, executeTopicAutoSummaryOptions } from './execute';

const app = new Hono();

app.post(
  '/dispatch',
  serve(
    withOtelMetricsForUpstashWorkflows(dispatchTopicAutoSummary, {
      url: '/api/workflows/topic-auto-summary/dispatch',
    }),
    { ...dispatchTopicAutoSummaryOptions, qstashClient: createWorkflowQstashClient() },
  ),
);

app.post(
  '/execute',
  serve(
    withOtelMetricsForUpstashWorkflows(executeTopicAutoSummary, {
      url: '/api/workflows/topic-auto-summary/execute',
    }),
    { ...executeTopicAutoSummaryOptions, qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
