import { Hono } from 'hono';

import { qstashAuth } from '../middlewares/qstashAuth';
import { heartbeatTick } from './handlers/heartbeatTick';
import { onTopicComplete } from './handlers/onTopicComplete';
import { scheduleDispatch } from './handlers/scheduleDispatch';
import { scheduleExecute } from './handlers/scheduleExecute';
import { watchdog } from './handlers/watchdog';

const app = new Hono();

app.post('/on-topic-complete', qstashAuth(), onTopicComplete);
app.post('/heartbeat-tick', qstashAuth(), heartbeatTick);
app.post('/schedule-dispatch', qstashAuth(), scheduleDispatch);
app.post('/schedule-execute', qstashAuth(), scheduleExecute);
app.post('/watchdog', qstashAuth(), watchdog);

export default app;
