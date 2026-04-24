import { Hono } from 'hono';

import { onTopicComplete } from './handlers/onTopicComplete';

const app = new Hono();

app.post('/on-topic-complete', onTopicComplete);

export default app;
