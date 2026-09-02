import type { Context } from 'hono';
import { Hono } from 'hono';

import { nextCompat } from './next-compat/context';

const app = new Hono();

app.use('*', nextCompat());

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
app.all('/trpc/async/*', (c) => fetchWith(c, () => import('./trpc/async')));
app.all('/trpc/lambda/*', (c) => fetchWith(c, () => import('./trpc/lambda')));
app.all('/trpc/mobile/*', (c) => fetchWith(c, () => import('./trpc/mobile')));
app.all('/trpc/tools/*', (c) => fetchWith(c, () => import('./trpc/tools')));

export default app;
