import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { onVerifierComplete } from './handlers/onVerifierComplete';

const app = new Hono();

app.post('/on-verifier-complete', qstashAuth(), onVerifierComplete);

export default app;
