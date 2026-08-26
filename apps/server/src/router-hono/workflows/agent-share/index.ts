import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { sweep } from './handlers/sweep';

const app = new Hono();

app.post('/sweep', qstashAuth(), sweep);

export default app;
