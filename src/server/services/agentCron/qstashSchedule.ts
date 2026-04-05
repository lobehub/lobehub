import debug from 'debug';

import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

const log = debug('server:agentCron:qstashSchedule');

type CronScheduleJob = {
  cronPattern: string;
  id: string;
  timezone?: string | null;
};

const buildQStashCron = (job: CronScheduleJob): string => {
  const timezone = job.timezone?.trim();
  if (!timezone) return job.cronPattern;

  return `CRON_TZ=${timezone} ${job.cronPattern}`;
};

const buildExecuteUrl = (): string => {
  // QStash is an external service and must call a publicly reachable URL.
  // Do not use INTERNAL_APP_URL here because it may be private/localhost.
  const baseUrl = appEnv.APP_URL || appEnv.INTERNAL_APP_URL;

  return new URL('/api/agent/cron/execute', baseUrl).toString();
};

export const upsertCronJobSchedule = async (job: CronScheduleJob): Promise<string> => {
  const qstashCron = buildQStashCron(job);

  log(
    'Upserting QStash schedule: jobId=%s cronPattern=%s timezone=%s qstashCron=%s',
    job.id,
    job.cronPattern,
    job.timezone || 'UTC',
    qstashCron,
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Forward Vercel deployment protection bypass header to destination endpoint
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const response = await qstashClient.schedules.create({
    body: JSON.stringify({ jobId: job.id }),
    cron: qstashCron,
    destination: buildExecuteUrl(),
    headers,
    method: 'POST',
    retries: 3,
    scheduleId: job.id,
  });

  log('Upserted QStash schedule: jobId=%s scheduleId=%s', job.id, response.scheduleId);

  return response.scheduleId;
};

export const deleteCronJobSchedule = async (jobId: string): Promise<void> => {
  try {
    log('Deleting QStash schedule: jobId=%s scheduleId=%s', jobId, jobId);
    await qstashClient.schedules.delete(jobId);
    log('Deleted QStash schedule: jobId=%s scheduleId=%s', jobId, jobId);
  } catch (error) {
    // Idempotent delete: ignore not-found schedule
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('404') || message.toLowerCase().includes('not found')) {
      log('QStash schedule already absent: jobId=%s scheduleId=%s', jobId, jobId);
      return;
    }

    log('Failed to delete QStash schedule: jobId=%s scheduleId=%s error=%O', jobId, jobId, error);

    throw error;
  }
};
