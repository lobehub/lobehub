import type { Context } from 'hono';
import { Hono } from 'hono';

const app = new Hono();

const fetchWith = async (
  c: Context,
  importer: () => Promise<{
    default: { fetch: (request: Request) => Promise<Response> | Response };
  }>,
) => (await importer()).default.fetch(c.req.raw);

app.get('/api/agent/stream', async (c) =>
  (await import('@/server/api-runtime/agentStream')).agentStreamAPIHandler(c.req.raw),
);
app.all('/api/agent', (c) => fetchWith(c, () => import('@/server/agent-hono')));
app.all('/api/agent/*', (c) => fetchWith(c, () => import('@/server/agent-hono')));
app.post('/api/workflows/agent-eval-run/on-thread-complete', async (c) =>
  (
    await import('@/server/api-runtime/agentEvalRunWorkflow')
  ).agentEvalRunOnThreadCompleteAPIHandler(c.req.raw),
);
app.post('/api/workflows/agent-eval-run/on-trajectory-complete', async (c) =>
  (
    await import('@/server/api-runtime/agentEvalRunWorkflow')
  ).agentEvalRunOnTrajectoryCompleteAPIHandler(c.req.raw),
);
app.all('/api/workflows', (c) => fetchWith(c, () => import('@/server/workflows-hono')));
app.all('/api/workflows/*', (c) => fetchWith(c, () => import('@/server/workflows-hono')));
app.all('/api/*', (c) => fetchWith(c, () => import('@/server/api-hono')));
app.get('/f/:id', async (c) =>
  (await import('@/server/api-runtime/fileProxy')).fileProxyAPIHandler(c.req.raw, {
    id: c.req.param('id'),
  }),
);
app.get('/webapi/user/avatar/:id/:image', async (c) =>
  (await import('@/server/api-runtime/userAvatar')).userAvatarAPIHandler(c.req.raw, {
    id: c.req.param('id'),
    image: c.req.param('image'),
  }),
);
app.on(['GET', 'POST'], '/market/agent', async (c) =>
  (await import('@/server/api-runtime/market')).marketAgentAPIHandler(c.req.raw, {
    segments: [],
  }),
);
app.on(['GET', 'POST'], '/market/agent/*', async (c) =>
  (await import('@/server/api-runtime/market')).marketAgentAPIHandler(c.req.raw, {
    segments: c.req.path
      .replace(/^\/market\/agent\/?/, '')
      .split('/')
      .filter(Boolean),
  }),
);
app.on(['GET', 'POST'], '/market/oidc', async (c) =>
  (await import('@/server/api-runtime/market')).marketOIDCAPIHandler(c.req.raw, {
    segments: [],
  }),
);
app.on(['GET', 'POST'], '/market/oidc/*', async (c) =>
  (await import('@/server/api-runtime/market')).marketOIDCAPIHandler(c.req.raw, {
    segments: c.req.path
      .replace(/^\/market\/oidc\/?/, '')
      .split('/')
      .filter(Boolean),
  }),
);
app.on(['GET', 'POST'], '/market/social', async (c) =>
  (await import('@/server/api-runtime/market')).marketSocialAPIHandler(c.req.raw, {
    segments: [],
  }),
);
app.on(['GET', 'POST'], '/market/social/*', async (c) =>
  (await import('@/server/api-runtime/market')).marketSocialAPIHandler(c.req.raw, {
    segments: c.req.path
      .replace(/^\/market\/social\/?/, '')
      .split('/')
      .filter(Boolean),
  }),
);
app.get('/market/user/:username', async (c) =>
  (await import('@/server/api-runtime/market')).marketUserProfileAPIHandler(c.req.raw, {
    username: c.req.param('username'),
  }),
);
app.put('/market/user/me', async (c) =>
  (await import('@/server/api-runtime/market')).marketUserMeAPIHandler(c.req.raw),
);
app.get('/oidc/handoff', async (c) =>
  (await import('@/server/api-runtime/oidc')).oidcHandoffAPIHandler(c.req.raw),
);
app.get('/oidc/callback/desktop', async (c) =>
  (await import('@/server/api-runtime/oidc')).oidcCallbackDesktopAPIHandler(c.req.raw),
);
app.post('/oidc/clear-session', async (c) =>
  (await import('@/server/api-runtime/oidc')).oidcClearSessionAPIHandler(c.req.raw),
);
app.post('/oidc/consent', async (c) =>
  (await import('@/server/api-runtime/oidc')).oidcConsentAPIHandler(c.req.raw),
);
app.all('/oidc/*', async (c) =>
  (await import('@/server/api-runtime/oidc')).oidcProviderAPIHandler(c.req.raw),
);
app.get('/webapi/models/:provider', async (c) =>
  (await import('@/server/api-runtime/models')).modelsAPIHandler(c.req.raw, {
    provider: c.req.param('provider'),
  }),
);
app.post('/webapi/models/:provider/pull', async (c) =>
  (await import('@/server/api-runtime/models')).pullModelsAPIHandler(c.req.raw, {
    provider: c.req.param('provider'),
  }),
);
app.post('/webapi/chat/:provider', async (c) =>
  (await import('@/server/api-runtime/chat')).chatAPIHandler(c.req.raw, {
    provider: c.req.param('provider'),
  }),
);
app.post('/webapi/create-image/comfyui', async (c) =>
  (await import('@/server/api-runtime/createImage')).comfyUICreateImageAPIHandler(c.req.raw),
);
app.post('/webapi/tts/edge', async (c) =>
  (await import('@/server/api-runtime/speech')).edgeTTSAPIHandler(c.req.raw),
);
app.post('/webapi/tts/microsoft', async (c) =>
  (await import('@/server/api-runtime/speech')).microsoftTTSAPIHandler(c.req.raw),
);
app.post('/webapi/tts/openai', async (c) =>
  (await import('@/server/api-runtime/speech')).openAITTSAPIHandler(c.req.raw),
);
app.post('/webapi/stt/openai', async (c) =>
  (await import('@/server/api-runtime/speech')).openAISTTAPIHandler(c.req.raw),
);
app.post('/webapi/trace', async (c) =>
  (await import('@/server/api-runtime/trace')).traceAPIHandler(c.req.raw),
);
app.all('/trpc/*', (c) => fetchWith(c, () => import('@/server/trpc-hono')));

export default app;
