import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { managedDeviceToken, NO_STORE } from './handlers/managedDeviceToken';

/**
 * Hono app for `/api/device/*` endpoints called by devices themselves, outside
 * a user session. Each path has its own Next.js route shell under
 * `src/app/(backend)/api/device`.
 */
const MAX_BODY_BYTES = 16 * 1024;

const app = new Hono().basePath('/api/device');

app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'Request body is too large' }, 413, NO_STORE),
  }),
);

// POST /api/device/managed/token — managed cloud device credential exchange
app.post('/managed/token', managedDeviceToken);

export default app;
