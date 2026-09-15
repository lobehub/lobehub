import { Hono } from 'hono';

import { memoryWebhookAuth } from '../webhooks/middlewares/memoryWebhookAuth';
import { agentTracing } from './handlers/agentTracing';
import { memoryUserMemoryBenchmarkLocomo } from './handlers/memoryUserMemoryBenchmarkLocomo';
import { testPush } from './handlers/testPush';
import { devOnly } from './middlewares/devOnly';

// Named `devtools` rather than `dev` because `router-hono/dev.ts` is the
// standalone dev-server bootstrap and would shadow a `dev/` directory.
const app = new Hono().basePath('/api/dev');

app.get('/agent-tracing', devOnly(), agentTracing);
app.post('/test-push', devOnly(), testPush);

// Not devOnly: gated by the `enableBenchmarkLoCoMo` flag so it can run against
// a deployed benchmark environment.
app.post(
  '/memory-user-memory/benchmark-locomo',
  memoryWebhookAuth(),
  memoryUserMemoryBenchmarkLocomo,
);

export default app;
