import { Hono } from 'hono';

import { execAgent } from './handlers/execAgent';
import { finalizeAbandoned } from './handlers/finalizeAbandoned';
import { toolResult } from './handlers/toolResult';
import { qstashOrApiKeyAuth } from './middlewares/qstashOrApiKeyAuth';
import { serviceTokenAuth } from './middlewares/serviceTokenAuth';

/**
 * Hono app for `/api/agent/*` endpoints. Mounted via the Next.js optional
 * catch-all at `src/app/(backend)/api/agent/[[...route]]/route.ts`.
 *
 * Routing precedence: existing static `route.ts` files (e.g. `run/route.ts`,
 * `stream/route.ts`, `gateway/*`, `webhooks/*`) win over the catch-all, so
 * individual paths can migrate one at a time — delete the static `route.ts`
 * and add the corresponding handler here.
 */
const app = new Hono().basePath('/api/agent');

// POST /api/agent — start a new agent operation (QStash sig OR API key)
app.post('/', qstashOrApiKeyAuth(), execAgent);

// POST /api/agent/tool-result — gateway-side tool result LPUSH'd to Redis
app.post('/tool-result', serviceTokenAuth(), toolResult);

// POST /api/agent/finalize-abandoned — watchdog reverse-trigger finalize
app.post('/finalize-abandoned', serviceTokenAuth(), finalizeAbandoned);
app.get('/finalize-abandoned', (c) =>
  c.json({
    healthy: true,
    message: 'Agent finalize-abandoned endpoint is running',
    timestamp: new Date().toISOString(),
  }),
);

export default app;
