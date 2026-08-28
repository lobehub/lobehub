import { Hono } from 'hono';

import { composioOAuthCallback } from './handlers/oauthCallback';

const app = new Hono().basePath('/api/composio');

app.get('/oauth/callback', composioOAuthCallback);

export default app;
