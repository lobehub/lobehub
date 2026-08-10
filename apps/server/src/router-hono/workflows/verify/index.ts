import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { onVerifierComplete } from './handlers/onVerifierComplete';
import { sweep } from './handlers/sweep';

const app = new Hono();

app.post('/on-verifier-complete', qstashAuth(), onVerifierComplete);
app.post('/sweep', qstashAuth(), sweep);

export default app;
