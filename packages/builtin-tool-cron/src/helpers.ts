import type { CronJobSummaryForContext } from './types';

const formatCronJob = (job: CronJobSummaryForContext): string => {
  const status = job.enabled ? 'enabled' : 'disabled';
  const execInfo =
    job.remainingExecutions != null ? `${job.remainingExecutions} remaining` : 'unlimited';
  const lastRun = job.lastExecutedAt ?? 'never';
  const desc = job.description ? ` - ${job.description}` : '';

  return `  - ${job.name || 'Unnamed'} (id: ${job.id}): ${job.cronPattern} [${job.timezone}] [${status}, ${execInfo}, ${job.totalExecutions} completed, last run: ${lastRun}]${desc}`;
};

export const generateCronJobsList = (jobs: CronJobSummaryForContext[], total?: number): string => {
  if (jobs.length === 0) {
    return 'No scheduled tasks configured for this agent.';
  }

  const lines = jobs.map(formatCronJob);

  if (total && total > jobs.length) {
    lines.push(`  (showing ${jobs.length} of ${total} tasks — use listCronJobs to see all)`);
  }

  return lines.join('\n');
};
