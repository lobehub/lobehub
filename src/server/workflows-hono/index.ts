import { Hono } from 'hono';

import agentSignalApp from './agent-signal';
import memoryUserMemoryApp from './memory-user-memory';
import taskApp from './task';
import { createTaskDispatchSchedule } from './task/bootstrap';

const app = new Hono().basePath('/api/workflows');

void createTaskDispatchSchedule().catch((error) => {
  console.error('[workflows-hono] Failed to create task dispatch schedule:', error);
});

app.route('/agent-signal', agentSignalApp);
app.route('/memory-user-memory', memoryUserMemoryApp);
app.route('/task', taskApp);

export default app;
