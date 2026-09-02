import { Hono } from 'hono';

import { check } from './handlers/check';
import {
  deleteExecutionPolicyHandler,
  getExecutionPolicyByUserHandler,
  upsertExecutionPolicyHandler,
} from './handlers/executionPolicy';
import { log as logHandler } from './handlers/log';
import { listLogs } from './handlers/logs';
import {
  createRuleHandler,
  deleteRuleHandler,
  listRules,
  updateRuleHandler,
} from './handlers/rules';
import { serviceTokenAuth } from './middlewares/serviceTokenAuth';

/**
 * Hono app for `/api/governance/*` — the server-to-server contract command
 * governance exposes to the admin panel (rules CRUD + logs query) and the
 * sandbox execution service (`check` + `log`). Every route requires
 * `COMMAND_GOVERNANCE_SERVICE_TOKEN` via `serviceTokenAuth`; there is no
 * end-user-facing auth on this router.
 *
 * Mounted the same way as `./agent` and `./workflows` — see `router-hono/index.ts`.
 */
const app = new Hono().basePath('/api/governance');

// POST /api/governance/check — evaluate a command before it runs
app.post('/check', serviceTokenAuth(), check);

// POST /api/governance/log — record the outcome of a governed command
app.post('/log', serviceTokenAuth(), logHandler);

// Rules CRUD (admin panel)
app.get('/rules', serviceTokenAuth(), listRules);
app.post('/rules', serviceTokenAuth(), createRuleHandler);
app.put('/rules/:id', serviceTokenAuth(), updateRuleHandler);
app.delete('/rules/:id', serviceTokenAuth(), deleteRuleHandler);

// GET /api/governance/logs — paginated audit log query (admin panel)
app.get('/logs', serviceTokenAuth(), listLogs);

// User execution policy CRUD (admin panel). The CLI/desktop fetch path does
// NOT go through this router — it authenticates as the end user via the
// lambda tRPC router (`ctx.userId`), not the service token, so it is never
// distributed to end-user devices. See
// `apps/server/src/routers/lambda/executionPolicy.ts`.
app.get('/execution-policy/:userId', serviceTokenAuth(), getExecutionPolicyByUserHandler);
app.put('/execution-policy/:userId', serviceTokenAuth(), upsertExecutionPolicyHandler);
app.delete('/execution-policy/:userId', serviceTokenAuth(), deleteExecutionPolicyHandler);

export default app;
