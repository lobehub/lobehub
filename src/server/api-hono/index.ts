import { Hono } from 'hono';

import { versionAPIHandler } from '@/server/api-runtime/version';

const app = new Hono().basePath('/api');

const fetchOpenAPI = async (request: Request) =>
  (await import('@/server/api-runtime/openapi')).openAPIHandler(request);
const fetchCheckUser = async (request: Request) =>
  (await import('@/server/api-runtime/auth')).checkUserAPIHandler(request);
const fetchResolveUsername = async (request: Request) =>
  (await import('@/server/api-runtime/auth')).resolveUsernameAPIHandler(request);
const fetchBetterAuth = async (request: Request) =>
  (await import('@/server/api-runtime/betterAuth')).betterAuthAPIHandler(request);
const fetchCasdoorWebhook = async (request: Request) =>
  (await import('@/server/api-runtime/webhooks')).casdoorWebhookAPIHandler(request);
const fetchLogtoWebhook = async (request: Request) =>
  (await import('@/server/api-runtime/webhooks')).logtoWebhookAPIHandler(request);
const fetchMemoryExtractChatTopicCancelWebhook = async (request: Request) =>
  (
    await import('@/server/api-runtime/memoryExtraction')
  ).memoryExtractChatTopicCancelWebhookAPIHandler(request);
const fetchMemoryExtractionWebhook = async (request: Request) =>
  (await import('@/server/api-runtime/memoryExtraction')).memoryExtractionWebhookAPIHandler(
    request,
  );
const fetchMemoryExtractionBenchmarkLoCoMoWebhook = async (request: Request) =>
  (
    await import('@/server/api-runtime/memoryExtractionBenchmark')
  ).memoryExtractionBenchmarkLoCoMoWebhookAPIHandler(request);
const fetchMemoryUserPersonaUpdateWritingWebhook = async (request: Request) =>
  (
    await import('@/server/api-runtime/memoryExtraction')
  ).memoryUserPersonaUpdateWritingWebhookAPIHandler(request);
const fetchVideoWebhook = async (request: Request, provider: string) =>
  (await import('@/server/api-runtime/videoWebhook')).videoWebhookAPIHandler(request, { provider });
const fetchAgentTracing = async (request: Request) =>
  (await import('@/server/api-runtime/dev')).agentTracingAPIHandler(request);
const fetchMemoryUserMemoryBenchmarkLoCoMoDev = async (request: Request) =>
  (
    await import('@/server/api-runtime/memoryBenchmarkDev')
  ).memoryUserMemoryBenchmarkLoCoMoDevAPIHandler(request);

app.post('/auth/check-user', (c) => fetchCheckUser(c.req.raw));
app.post('/auth/resolve-username', (c) => fetchResolveUsername(c.req.raw));
app.on(['GET', 'POST'], '/auth/*', (c) => fetchBetterAuth(c.req.raw));
app.get('/dev/agent-tracing', (c) => fetchAgentTracing(c.req.raw));
app.post('/dev/memory-user-memory/benchmark-locomo', (c) =>
  fetchMemoryUserMemoryBenchmarkLoCoMoDev(c.req.raw),
);
app.post('/webhooks/casdoor', (c) => fetchCasdoorWebhook(c.req.raw));
app.post('/webhooks/logto', (c) => fetchLogtoWebhook(c.req.raw));
app.post('/webhooks/memory-extraction', (c) => fetchMemoryExtractionWebhook(c.req.raw));
app.post('/webhooks/memory-extraction/benchmark-locomo', (c) =>
  fetchMemoryExtractionBenchmarkLoCoMoWebhook(c.req.raw),
);
app.post('/webhooks/memory-user-memory/pipelines/extract/chat-topic/cancel', (c) =>
  fetchMemoryExtractChatTopicCancelWebhook(c.req.raw),
);
app.post('/webhooks/memory-user-memory/persona/update-writing', (c) =>
  fetchMemoryUserPersonaUpdateWritingWebhook(c.req.raw),
);
app.post('/webhooks/video/:provider', (c) => fetchVideoWebhook(c.req.raw, c.req.param('provider')));
app.all('/v1', (c) => fetchOpenAPI(c.req.raw));
app.all('/v1/*', (c) => fetchOpenAPI(c.req.raw));
app.get('/version', (c) => versionAPIHandler(c.req.raw));

export default app;
