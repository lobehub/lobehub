import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { ResponsesController } from '../controllers/responses.controller';
import { requireAuth } from '../middleware/auth';
import { CreateResponseRequestSchema } from '../types/responses.type';

const ResponsesRoutes = new Hono();

/**
 * POST /api/v1/responses
 * Create a model response (OpenResponses protocol)
 */
ResponsesRoutes.post(
  '/',
  requireAuth,
  zValidator('json', CreateResponseRequestSchema),
  async (c) => {
    const controller = new ResponsesController();
    return await controller.createResponse(c);
  },
);

export default ResponsesRoutes;
