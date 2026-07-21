import { Hono } from 'hono';

import agentSignalApp from './agent-signal';
import memoryUserMemoryApp from './memory-user-memory';
import onboardingUnderstandingApp from './onboarding-understanding';
import taskApp from './task';
import verifyApp from './verify';

const app = new Hono().basePath('/api/workflows');

app.route('/agent-signal', agentSignalApp);
app.route('/memory-user-memory', memoryUserMemoryApp);
app.route('/onboarding/understanding', onboardingUnderstandingApp);
app.route('/task', taskApp);
app.route('/verify', verifyApp);

export default app;
