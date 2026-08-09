import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';

import { createOpenRouterInternalApp } from './openrouterInternal';
import { createControlPlaneTrpcApp } from './platformTrpc';

const app = new Hono();

const adminHtmlPath = fileURLToPath(new URL('../web/admin.html', import.meta.url));

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: '@aico/control-plane',
  }),
);

app.route('/internal/openrouter/v1/keys', createOpenRouterInternalApp());
app.route('/trpc/lambda', createControlPlaneTrpcApp());

app.get('/', (c) => {
  try {
    const html = readFileSync(adminHtmlPath, 'utf8');
    return c.html(html);
  } catch {
    return c.text('Aico control plane — admin UI missing', 500);
  }
});

app.get('/admin', (c) => c.redirect('/'));

export default app;
