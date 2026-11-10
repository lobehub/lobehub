import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { purge } from './handlers/purge';

const app = new Hono();

app.post('/purge', qstashAuth(), purge);

export default app;
