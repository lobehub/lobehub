import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve, serveMany } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { createWorkflowQstashClient } from '../qstashClient';
import { hourlyWorkflowHandler, hourlyWorkflowOptions } from './workflows/hourly';
import { personaUpdateHandler } from './workflows/personaUpdate';
import { processTopicWorkflow } from './workflows/processTopic';
import { processTopicsHandler } from './workflows/processTopics';
import { processUsersHandler, processUsersWorkflowOptions } from './workflows/processUsers';
import {
  processUserTopicsHandler,
  processUserTopicsWorkflowOptions,
} from './workflows/processUserTopics';

const app = new Hono();

app.post(
  '/call-cron-hourly-analysis',
  serve(
    withOtelMetricsForUpstashWorkflows(hourlyWorkflowHandler, {
      url: '/api/workflows/memory-user-memory/call-cron-hourly-analysis',
    }),
    {
      ...hourlyWorkflowOptions,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/persona/update-writing',
  serve(
    withOtelMetricsForUpstashWorkflows(personaUpdateHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/persona/update-writing',
    }),
    { qstashClient: createWorkflowQstashClient() },
  ),
);

app.post(
  '/pipelines/chat-topic/process-users',
  serve(
    withOtelMetricsForUpstashWorkflows(processUsersHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
    }),
    {
      ...processUsersWorkflowOptions,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-user-topics',
  serve(
    withOtelMetricsForUpstashWorkflows(processUserTopicsHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics',
    }),
    {
      ...processUserTopicsWorkflowOptions,
      qstashClient: createWorkflowQstashClient(),
    },
  ),
);

app.post(
  '/pipelines/chat-topic/process-topics',
  serve(
    withOtelMetricsForUpstashWorkflows(processTopicsHandler, {
      url: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
    }),
    { qstashClient: createWorkflowQstashClient() },
  ),
);

// NOTICE: Must use serveMany here. The `context.invoke(processTopicWorkflow)` call in
// process-topics rewrites the URL last segment to the workflowId ("process-topic"). serveMany
// multiplexes by that final segment to dispatch to the right workflow.
app.post(
  '/pipelines/chat-topic/process-topic',
  serveMany(
    { 'process-topic': processTopicWorkflow },
    { qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
