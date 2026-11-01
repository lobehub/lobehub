import { Hono } from 'hono';

import { zValidator } from '../common/validator';
import { ResponsesController } from '../controllers/responses.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { CreateResponseRequestSchema } from '../types/responses.type';

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
