import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { ToolController } from '../controllers/tool.controller';
import { requireAuth } from '../middleware/auth';
import { requirePaymentOr } from '../middleware/machine-payment';
import { machinePaymentGate } from '../middleware/machine-payment-gate';

/**
 * Tool gateway: builtin tool APIs exposed over HTTP, one path per API.
 *
 * Callers either authenticate as usual or — where the deployment sells the API —
 * pay per request over the Machine Payments Protocol (HTTP 402), with no
 * account at all. Which APIs are exposed is `PUBLIC_TOOL_APIS`.
 */
const ToolRoutes = new Hono();

/**
 * GET /api/v1/tools — public catalog. Open on purpose: an agent without an
 * account has to learn what it can buy, and the catalog only lists open-source
 * manifests plus prices.
 */
ToolRoutes.get(
  '/',
  describeRoute({
    operationId: 'listTools',
    summary: 'List tool APIs callable through the gateway',
    tags: ['tools'],
  }),
  async (c) => new ToolController().listTools(c),
);

/** POST /api/v1/tools/:identifier/:api — body is the tool's arguments object. */
ToolRoutes.post(
  '/:identifier/:api',
  describeRoute({ operationId: 'invokeTool', summary: 'Invoke a tool API', tags: ['tools'] }),
  machinePaymentGate(),
  requirePaymentOr(requireAuth),
  async (c) => new ToolController().invokeTool(c),
);

export default ToolRoutes;
