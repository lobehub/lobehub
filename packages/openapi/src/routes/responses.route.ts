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
 * The only money-burning endpoint on this surface: restricted API keys must
 * hold `model:invoke` to reach it.
 */
ResponsesRoutes.post(
  '/',
  requireAuth,
  requireApiKeyScope('model:invoke'),
  zValidator('json', CreateResponseRequestSchema),
  async (c) => {
    const controller = new ResponsesController();
    return await controller.createResponse(c);
  },
);

export default ResponsesRoutes;
