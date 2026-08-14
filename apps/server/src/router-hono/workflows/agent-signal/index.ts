import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { runAgentSignalWorkflow } from '@/server/workflows/agentSignal/run';
import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal/types';

import { qstashAuth } from '../middlewares/qstashAuth';
import { createWorkflowQstashClient } from '../qstashClient';
import { scheduleNightlyReview } from './handlers/scheduleNightlyReview';
import {
  executeNightlyReviewUser,
  executeNightlyReviewUserOptions,
  paginateNightlyReviewUsers,
  paginateNightlyReviewUsersOptions,
} from './workflows/nightlyReview';

const app = new Hono();

app.post('/cron-hourly-nightly-self-review', qstashAuth(), scheduleNightlyReview);

app.post(
  '/paginate-nightly-review-users',
  serve(
    withOtelMetricsForUpstashWorkflows(paginateNightlyReviewUsers, {
      url: '/api/workflows/agent-signal/paginate-nightly-review-users',
    }),
    {
      ...paginateNightlyReviewUsersOptions,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/execute-nightly-review-user',
  serve(
    withOtelMetricsForUpstashWorkflows(executeNightlyReviewUser, {
      url: '/api/workflows/agent-signal/execute-nightly-review-user',
    }),
    {
      ...executeNightlyReviewUserOptions,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

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
