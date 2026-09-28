import { Hono } from 'hono';

import { casdoorWebhook } from './handlers/casdoor';
import { githubWebhook } from './handlers/github';
import { githubInstall } from './handlers/githubInstall';
import { githubSetup } from './handlers/githubSetup';
import { logtoWebhook } from './handlers/logto';
import { memoryExtractionWebhook } from './handlers/memoryExtraction';
import { memoryExtractionBenchmarkLocomo } from './handlers/memoryExtractionBenchmarkLocomo';
import { memoryUserMemoryChatTopicCancel } from './handlers/memoryUserMemoryChatTopicCancel';
import { memoryUserMemoryPersonaUpdateWriting } from './handlers/memoryUserMemoryPersonaUpdateWriting';
import { videoWebhook } from './handlers/video';
import { memoryWebhookAuth } from './middlewares/memoryWebhookAuth';

const app = new Hono().basePath('/api/webhooks');

// Identity provider webhooks — each verifies its own provider signature.
app.post('/casdoor', casdoorWebhook);
app.post('/logto', logtoWebhook);

// Memory pipeline webhooks — share the configured static-header guard.
app.post('/memory-extraction', memoryWebhookAuth(), memoryExtractionWebhook);
app.post(
  '/memory-extraction/benchmark-locomo',
  memoryWebhookAuth(),
  memoryExtractionBenchmarkLocomo,
);
app.post(
  '/memory-user-memory/persona/update-writing',
  memoryWebhookAuth(),
  memoryUserMemoryPersonaUpdateWriting,
);
app.post(
  '/memory-user-memory/pipelines/extract/chat-topic/cancel',
  memoryWebhookAuth(),
  memoryUserMemoryChatTopicCancel,
);

// Async video generation callback; the token is verified per asyncTask.
app.post('/video/:provider', videoWebhook);

// GitHub App: signed event ingress plus the install / setup redirects GitHub
// sends the user through. The GET routes share the prefix because the App's
// Callback URL and Setup URL are registered on GitHub next to the webhook URL.
app.post('/github', githubWebhook);
app.get('/github/install', githubInstall);
app.get('/github/setup', githubSetup);
app.get('/github/oauth/callback', githubSetup);

export default app;
