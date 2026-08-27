import { Hono } from 'hono';

import agentEvalRunApp from './agent-eval-run';
import agentSignalApp from './agent-signal';
import expertiseHistoryApp from './expertise-history';
import goalApp from './goal';
import memoryUserMemoryApp from './memory-user-memory';
import onboardingTaskRecommendationApp from './onboarding-task-recommendation';
import onboardingUnderstandingApp from './onboarding-understanding';
import taskApp from './task';
import topicAutoSummaryApp from './topic-auto-summary';
import verifyApp from './verify';

const app = new Hono().basePath('/api/workflows');

app.route('/agent-eval-run', agentEvalRunApp);
app.route('/agent-signal', agentSignalApp);
app.route('/expertise-history', expertiseHistoryApp);
app.route('/goal', goalApp);
app.route('/memory-user-memory', memoryUserMemoryApp);
app.route('/onboarding/understanding', onboardingUnderstandingApp);
app.route('/onboarding/task-recommendations', onboardingTaskRecommendationApp);
app.route('/task', taskApp);
app.route('/topic-auto-summary', topicAutoSummaryApp);
app.route('/verify', verifyApp);

export default app;
