import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { advance } from './handlers/advance';
import { sweep } from './handlers/sweep';

const app = new Hono();

app.post('/advance', qstashAuth(), advance);
app.post('/sweep', qstashAuth(), sweep);

export default app;
