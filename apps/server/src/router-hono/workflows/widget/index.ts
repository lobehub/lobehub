import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { runWidget } from './handlers/runWidget';
import { tick } from './handlers/tick';

const app = new Hono();

app.post('/tick', qstashAuth(), tick);
app.post('/run-widget', qstashAuth(), runWidget);

export default app;
