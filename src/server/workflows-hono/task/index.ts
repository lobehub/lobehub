import { Hono } from 'hono';

import { heartbeatTick } from './handlers/heartbeatTick';
import { onTopicComplete } from './handlers/onTopicComplete';
import { watchdog } from './handlers/watchdog';

const app = new Hono();

app.post('/on-topic-complete', onTopicComplete);
app.post('/heartbeat-tick', heartbeatTick);
app.post('/watchdog', watchdog);

export default app;
