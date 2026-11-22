import { Hono } from 'hono';

import { CREATE_RESPONSE_EXAMPLE, example, RESPONSE_EXAMPLE } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ResponsesController } from '../controllers/responses.controller';
import { requireAuth } from '../middleware/auth';
import { OpenResponsesHttpErrorSchema } from '../middleware/open-responses-errors';
import { requireApiKeyScope } from '../middleware/permission-check';
import { CreateResponseRequestSchema, ResponseObjectSchema } from '../types/responses.type';
import { ResponseStreamEventSchema } from '../types/responses-stream.type';

const ResponsesRoutes = new Hono();

/**
 * POST /api/v1/responses
 * Create a model response (OpenResponses protocol)
 *
 * Burns model quota AND runs through `AiAgentService.execAgent` (the request
 * `model` is an agent id), persisting topic/message state — so restricted
 * keys need the same `agent:write` + `chat:write` + `model:invoke` trio as
 * the tRPC agent-run entries.
 */
ResponsesRoutes.post(
  '/',
  routeDoc({
    data: ResponseObjectSchema,
    description:
      'OpenResponses-compatible: `model` takes an agent id. Without `stream` the response object is the whole JSON body (no success envelope); a run that fails still answers 200 with `status: "failed"` and `error`. With `stream: true` the body is `text/event-stream`: each message is `event: <type>` plus `data: <ResponseStreamEvent JSON>`, and the final `response.completed` / `response.failed` / `response.incomplete` event carries the same response object.',
    // The handler answers `c.json(response)` directly, not `this.success(...)`.
    envelope: false,
    // OpenResponses clients parse `error.message`/`error.type`, so HTTP errors
    // keep the protocol's shape (plus `requestId`) instead of `ApiError`.
    errorSchema: OpenResponsesHttpErrorSchema,
    errors: [400],
    streamContent: { 'text/event-stream': { schema: ResponseStreamEventSchema } },
    requestExample: example(CreateResponseRequestSchema, CREATE_RESPONSE_EXAMPLE),
    responseExample: RESPONSE_EXAMPLE,
    summary: 'Create a model response',
    tags: ['responses'],
  }),
  requireAuth,
  requireApiKeyScope('model:invoke'),
  requireApiKeyScope('chat:write'),
  requireApiKeyScope('agent:write'),
  zValidator('json', CreateResponseRequestSchema),
  async (c) => {
    const controller = new ResponsesController();
    return await controller.createResponse(c);
  },
);

export default ResponsesRoutes;
