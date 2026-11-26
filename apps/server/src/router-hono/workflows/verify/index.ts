import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { onEvidenceComplete } from './handlers/onEvidenceComplete';
import { onOperationComplete } from './handlers/onOperationComplete';
import { onVerifierComplete } from './handlers/onVerifierComplete';
import { sweep } from './handlers/sweep';

const app = new Hono();

app.post('/on-evidence-complete', qstashAuth(), onEvidenceComplete);
app.post('/on-operation-complete', qstashAuth(), onOperationComplete);
app.post('/on-verifier-complete', qstashAuth(), onVerifierComplete);
app.post('/sweep', qstashAuth(), sweep);

export default app;
