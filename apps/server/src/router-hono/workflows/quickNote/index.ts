import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { onQuickNoteRunComplete } from './handlers/onRunComplete';
import { sweepQuickNoteAnalyze } from './handlers/sweep';

const app = new Hono();

app.post('/on-run-complete', qstashAuth(), onQuickNoteRunComplete);
app.post('/sweep', qstashAuth(), sweepQuickNoteAnalyze);

export default app;
