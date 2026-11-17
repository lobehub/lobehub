import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { RunController } from '../controllers/run.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import {
  CancelRunResultSchema,
  CreateRunRequestSchema,
  CreateRunResultSchema,
  QueueRunMessageRequestSchema,
  QueueRunMessageResultSchema,
  RemoveRunQueuedMessageResultSchema,
  ResolveRunInterventionRequestSchema,
  ResolveRunInterventionResultSchema,
  RunEventSchema,
  RunEventsQuerySchema,
  RunIdParamSchema,
  RunInterventionListSchema,
  RunInterventionParamSchema,
  RunQueuedMessageListSchema,
  RunQueuedMessageParamSchema,
  RunSchema,
  SubmitRunToolResultsRequestSchema,
  SubmitRunToolResultsResultSchema,
} from '../types/run.type';

/**
 * Agent run routes.
 *
 * A run is one agent operation: `POST /runs` starts it in the background and
 * answers 202 with its id, which is also the `operationId` returned by
 * `/im/messages` and `/tasks/{id}/runs`. Follow it with `GET /runs/{id}` or the
 * `GET /runs/{id}/events` stream, and steer it with the sub-resources below.
 *
 * Scopes: reads need `run:read`, control needs `run:write`; anything that makes
 * the model run (start, resume after an intervention or tool results, a queued
 * message) also needs `model:invoke`.
 */
const RunRoutes = new Hono();

const runRead = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('MESSAGE_READ'),
  'run:read',
  'You do not have permission to view runs',
);
const runWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('MESSAGE_CREATE'),
  'run:write',
  'You do not have permission to control runs',
);
const modelInvoke = requireApiKeyScope('model:invoke');

const TAGS = ['runs'];

/** POST /api/v1/runs — start (or schedule) a run in the background. */
RunRoutes.post(
  '/',
  routeDoc({
    data: CreateRunResultSchema,
    description:
      'Stores the input as a user message and starts the agent in the background. Answers 202 with the run id; follow it through `GET /runs/{id}/events`. With `scheduledAt` the run is only scheduled: the response has status `scheduled` and no run id.',
    // 404: agent, group or topic not found; 409: the conversation is busy.
    errors: [404, 409],
    operationId: 'runs.create',
    requestExample: example(CreateRunRequestSchema, {
      agentId: 'agt_6sQwJ3dVbX1m',
      input: 'Summarize the open issues labelled `bug`.',
    }),
    responseExample: {
      id: 'op_1763370000000_agt_6sQwJ3dVbX1m_tpc_9Lw2',
      scheduledAt: null,
      status: 'queued',
      topicId: 'tpc_9Lw2kQhX0c7a',
      userMessageId: 'msg_3HsP0fWq1Zxa',
    },
    status: 202,
    summary: 'Start an agent run',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  modelInvoke,
  zValidator('json', CreateRunRequestSchema),
  async (c) => new RunController().createRun(c),
);

/** GET /api/v1/runs/:id — status, steps, usage and result. */
RunRoutes.get(
  '/:id',
  routeDoc({
    data: RunSchema,
    description:
      'Status, step count, token usage and cost, the final reply of a completed run, and what a waiting run waits on (`pendingInterventionCount`, `pendingToolCalls`). Accepts the `operationId` returned by `/im/messages` and `/tasks/{id}/runs`.',
    errors: [404],
    operationId: 'runs.get',
    summary: 'Get a run',
    tags: TAGS,
  }),
  requireAuth,
  runRead,
  zValidator('param', RunIdParamSchema),
  async (c) => new RunController().getRun(c),
);

/** GET /api/v1/runs/:id/events — server-sent event stream. */
RunRoutes.get(
  '/:id/events',
  routeDoc({
    data: RunEventSchema,
    description:
      'Server-sent events (`text/event-stream`). Replays the run from its first event, or from `Last-Event-ID` (header) / `after` (query) to resume without gaps. The stream closes after `run.completed`, `run.failed`, `run.cancelled` or `run.waiting`; it also closes after a few minutes, so reconnect with the last id until one of those arrives. Lines starting with `:` are heartbeats.',
    envelope: false,
    errors: [404],
    operationId: 'runs.events',
    streamContent: { 'text/event-stream': { schema: RunEventSchema } },
    summary: 'Stream run events',
    tags: TAGS,
  }),
  requireAuth,
  runRead,
  zValidator('param', RunIdParamSchema),
  zValidator('query', RunEventsQuerySchema),
  async (c) => new RunController().streamEvents(c),
);

/** POST /api/v1/runs/:id/cancel */
RunRoutes.post(
  '/:id/cancel',
  routeDoc({
    data: CancelRunResultSchema,
    description:
      'Stops a running run, or one waiting on an intervention. A finished run is left as it is (`cancelled: false`).',
    // 409: the runtime could not confirm the stop; retry.
    errors: [404, 409],
    operationId: 'runs.cancel',
    summary: 'Cancel a run',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  zValidator('param', RunIdParamSchema),
  async (c) => new RunController().cancelRun(c),
);

/** GET /api/v1/runs/:id/interventions */
RunRoutes.get(
  '/:id/interventions',
  routeDoc({
    data: RunInterventionListSchema,
    description: 'Tool approvals and questions the run waits on (status `waiting_for_human`).',
    errors: [404],
    operationId: 'runs.listInterventions',
    summary: 'List pending interventions',
    tags: TAGS,
  }),
  requireAuth,
  runRead,
  zValidator('param', RunIdParamSchema),
  async (c) => new RunController().listInterventions(c),
);

/** POST /api/v1/runs/:id/interventions/:interventionId */
RunRoutes.post(
  '/:id/interventions/:interventionId',
  routeDoc({
    data: ResolveRunInterventionResultSchema,
    description:
      'Approve or reject a tool call, or answer (or skip) a question. The agent carries on as a new run, `continuedByRunId`; stream that one next.',
    // 400: the action does not fit the intervention; 409: already resolved.
    errors: [400, 404, 409],
    operationId: 'runs.resolveIntervention',
    requestExample: example(ResolveRunInterventionRequestSchema, { action: 'approve' }),
    summary: 'Resolve an intervention',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  modelInvoke,
  zValidator('param', RunInterventionParamSchema),
  zValidator('json', ResolveRunInterventionRequestSchema),
  async (c) => new RunController().resolveIntervention(c),
);

/** POST /api/v1/runs/:id/tool-results */
RunRoutes.post(
  '/:id/tool-results',
  routeDoc({
    data: SubmitRunToolResultsResultSchema,
    description:
      'Results of your own function tools (`pendingToolCalls`) for a run in `waiting_for_tool_results`. Send one for every pending call; the run resumes under the same id.',
    // 409: the run is not waiting for these results.
    errors: [404, 409],
    operationId: 'runs.submitToolResults',
    requestExample: example(SubmitRunToolResultsRequestSchema, {
      results: [{ callId: 'call_2b3c', output: '{"temperature":21}' }],
    }),
    summary: 'Submit client tool results',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  modelInvoke,
  zValidator('param', RunIdParamSchema),
  zValidator('json', SubmitRunToolResultsRequestSchema),
  async (c) => new RunController().submitToolResults(c),
);

/** POST /api/v1/runs/:id/messages — queue a message behind the running turn. */
RunRoutes.post(
  '/:id/messages',
  routeDoc({
    data: QueueRunMessageResultSchema,
    description:
      'Queues a user message behind the running turn. The agent picks it up at its next decision point and answers it as the next turn. Retry with the same `id` when the outcome is unknown.',
    // 409: the run is not live anymore, or the queue is full; 503: queue store unavailable.
    errors: [404, 409, 503],
    operationId: 'runs.queueMessage',
    requestExample: example(QueueRunMessageRequestSchema, {
      content: 'Also include issues labelled `regression`.',
    }),
    status: 202,
    summary: 'Queue a message on a running run',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  modelInvoke,
  zValidator('param', RunIdParamSchema),
  zValidator('json', QueueRunMessageRequestSchema),
  async (c) => new RunController().queueMessage(c),
);

/** GET /api/v1/runs/:id/messages */
RunRoutes.get(
  '/:id/messages',
  routeDoc({
    data: RunQueuedMessageListSchema,
    description:
      'Your messages queued behind the run that it has not answered yet, oldest first. `delivering` ones were picked up and can no longer be withdrawn.',
    errors: [404, 503],
    operationId: 'runs.listQueuedMessages',
    summary: 'List messages queued on a run',
    tags: TAGS,
  }),
  requireAuth,
  runRead,
  zValidator('param', RunIdParamSchema),
  async (c) => new RunController().listQueuedMessages(c),
);

/** DELETE /api/v1/runs/:id/messages/:messageId */
RunRoutes.delete(
  '/:id/messages/:messageId',
  routeDoc({
    data: RemoveRunQueuedMessageResultSchema,
    description:
      'Withdraws a queued message. A message the run already picked up cannot be withdrawn (`removed: false`).',
    errors: [404, 503],
    operationId: 'runs.removeQueuedMessage',
    summary: 'Withdraw a queued message',
    tags: TAGS,
  }),
  requireAuth,
  runWrite,
  zValidator('param', RunQueuedMessageParamSchema),
  async (c) => new RunController().removeQueuedMessage(c),
);

export default RunRoutes;
