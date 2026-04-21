import type { CronJobSummaryForContext } from './types';

const formatCronJob = (job: CronJobSummaryForContext): string => {
  const status = job.enabled ? 'enabled' : 'disabled';
  const execInfo =
    job.remainingExecutions != null ? `${job.remainingExecutions} remaining` : 'unlimited';
  const lastRun = job.lastExecutedAt ?? 'never';
  const desc = job.description ? ` - ${job.description}` : '';

  return `  - ${job.name || 'Unnamed'} (id: ${job.id}): ${job.cronPattern} [${job.timezone}] [${status}, ${execInfo}, ${job.totalExecutions} completed, last run: ${lastRun}]${desc}`;
};

export const generateCronJobsList = (jobs: CronJobSummaryForContext[]): string => {
  if (jobs.length === 0) {
    return 'No scheduled tasks configured for this agent.';
  }

  return jobs.map(formatCronJob).join('\n');
};
