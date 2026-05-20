import { Hono } from 'hono';

import { botCallback } from './handlers/botCallback';
import { execAgent } from './handlers/execAgent';
import { finalizeAbandoned } from './handlers/finalizeAbandoned';
import { gatewayCallback } from './handlers/gatewayCallback';
import { gatewayCron } from './handlers/gatewayCron';
import { gatewayStart } from './handlers/gatewayStart';
import { messengerInstall } from './handlers/messengerInstall';
import { messengerOAuthCallback } from './handlers/messengerOAuthCallback';
import { messengerWebhook } from './handlers/messengerWebhook';
import { platformWebhook } from './handlers/platformWebhook';
import { runStep, runStepHealth } from './handlers/runStep';
import { toolResult } from './handlers/toolResult';
import { bearerSecretAuth } from './middlewares/bearerSecretAuth';
import { qstashAuth } from './middlewares/qstashAuth';
import { qstashOrApiKeyAuth } from './middlewares/qstashOrApiKeyAuth';
import { serviceTokenAuth } from './middlewares/serviceTokenAuth';

/**
 * Hono app for `/api/agent/*` endpoints. Mounted via the Next.js optional
 * catch-all at `src/app/(backend)/api/agent/[[...route]]/route.ts`.
 *
 * Routing precedence: existing static `route.ts` files win over the catch-all,
 * so individual paths can migrate one at a time — delete the static `route.ts`
 * and add the corresponding handler here.
 */
const app = new Hono().basePath('/api/agent');

// POST /api/agent — start a new agent operation (QStash sig OR API key)
app.post('/', qstashOrApiKeyAuth(), execAgent);

// POST /api/agent/run — execute a single step (QStash signature)
app.post('/run', qstashAuth(), runStep);
app.get('/run', runStepHealth);

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

// GET /api/agent/gateway — Vercel cron entry point (Bearer CRON_SECRET)
app.get(
  '/gateway',
  bearerSecretAuth(() => process.env.CRON_SECRET),
  gatewayCron,
);

// POST /api/agent/gateway/start — non-Vercel ensureRunning (Bearer KEY_VAULTS_SECRET)
app.post(
  '/gateway/start',
  bearerSecretAuth(() => process.env.KEY_VAULTS_SECRET),
  gatewayStart,
);

// POST /api/agent/gateway/callback — message gateway state-change callbacks
// (auth is inline so the disabled-feature 204 short-circuits before auth)
app.post('/gateway/callback', gatewayCallback);

// POST /api/agent/webhooks/bot-callback — agent step/completion webhooks (QStash)
app.post('/webhooks/bot-callback', qstashAuth(), botCallback);

// POST /api/agent/webhooks/:platform[/:appId] — Chat SDK bot platform webhooks
app.post('/webhooks/:platform/:appId?', platformWebhook);

// GET /api/agent/messenger/:platform/install — start per-tenant OAuth install
app.get('/messenger/:platform/install', messengerInstall);

// GET /api/agent/messenger/:platform/oauth/callback — OAuth redirect target
app.get('/messenger/:platform/oauth/callback', messengerOAuthCallback);

// POST /api/agent/messenger/webhooks/:platform — shared Messenger bot webhook
app.post('/messenger/webhooks/:platform', messengerWebhook);

export default app;
