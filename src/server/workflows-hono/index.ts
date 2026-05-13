import { Hono } from 'hono';

import agentEvalRunApp from './agent-eval-run';
import agentSignalApp from './agent-signal';
import memoryUserMemoryApp from './memory-user-memory';
import taskApp from './task';

const app = new Hono().basePath('/api/workflows');

app.route('/agent-eval-run', agentEvalRunApp);
app.route('/agent-signal', agentSignalApp);
app.route('/memory-user-memory', memoryUserMemoryApp);
app.route('/task', taskApp);

export default app;
