import { Hono } from 'hono';

import { noStore } from '../middlewares/noStore';
import { composioOAuthCallback } from './handlers/oauthCallback';

const app = new Hono().basePath('/api/composio');

app.use('*', noStore());

app.get('/oauth/callback', composioOAuthCallback);

export default app;
