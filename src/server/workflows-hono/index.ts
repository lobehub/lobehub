import { Hono } from 'hono';

import memoryUserMemoryApp from './memory-user-memory';
import taskApp from './task';

const app = new Hono().basePath('/api/workflows');

app.route('/memory-user-memory', memoryUserMemoryApp);
app.route('/task', taskApp);

export default app;
