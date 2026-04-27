import { serve, serveMany } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { createWorkflowQstashClient } from '../qstashClient';
import { hourlyWorkflowHandler, hourlyWorkflowOptions } from './workflows/hourly';
import { personaUpdateHandler } from './workflows/personaUpdate';
import { processTopicWorkflow } from './workflows/processTopic';
import { processTopicsHandler } from './workflows/processTopics';
import { processUsersHandler } from './workflows/processUsers';
import { processUserTopicsHandler } from './workflows/processUserTopics';

const app = new Hono();

app.post(
  '/call-cron-hourly-analysis',
  serve(hourlyWorkflowHandler, {
    ...hourlyWorkflowOptions,
    qstashClient: createWorkflowQstashClient(),
  }),
);

app.post(
  '/pipelines/persona/update-writing',
  serve(personaUpdateHandler, { qstashClient: createWorkflowQstashClient() }),
);

app.post(
  '/pipelines/chat-topic/process-users',
  serve(processUsersHandler, { qstashClient: createWorkflowQstashClient() }),
);

app.post(
  '/pipelines/chat-topic/process-user-topics',
  serve(processUserTopicsHandler, { qstashClient: createWorkflowQstashClient() }),
);

app.post(
  '/pipelines/chat-topic/process-topics',
  serve(processTopicsHandler, { qstashClient: createWorkflowQstashClient() }),
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
