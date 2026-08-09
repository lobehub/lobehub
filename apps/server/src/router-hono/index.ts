import type { Context } from 'hono';
import { Hono } from 'hono';

const app = new Hono();

const fetchWith = async (
  c: Context,
  importer: () => Promise<{
    default: { fetch: (request: Request) => Promise<Response> | Response };
  }>,
) => (await importer()).default.fetch(c.req.raw);

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: '@lobechat/server',
  }),
);

app.all('/api/agent', (c) => fetchWith(c, () => import('./agent')));
app.all('/api/agent/*', (c) => fetchWith(c, () => import('./agent')));
app.all('/api/workflows', (c) => fetchWith(c, () => import('./workflows')));
app.all('/api/workflows/*', (c) => fetchWith(c, () => import('./workflows')));

export default app;
