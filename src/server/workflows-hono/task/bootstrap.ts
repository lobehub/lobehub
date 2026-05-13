import debug from 'debug';

import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

const log = debug('lobe-server:workflows:task:bootstrap');

const TASK_DISPATCH_SCHEDULE_ID = 'task-schedule-dispatch';
const TASK_DISPATCH_CRON = '*/10 * * * *';
const TASK_DISPATCH_PATH = '/api/workflows/task/schedule-dispatch';

export const createTaskDispatchSchedule = async (): Promise<void> => {
  const appUrl = appEnv.APP_URL ?? appEnv.INTERNAL_APP_URL;

  if (!appEnv.enableQueueAgentRuntime) return;

  if (!appUrl) {
    throw new Error('APP_URL is required to create the task dispatch QStash schedule');
  }

  const destination = `${appUrl.replace(/\/$/, '')}${TASK_DISPATCH_PATH}`;

  await qstashClient.schedules.create({
    body: JSON.stringify({}),
    cron: TASK_DISPATCH_CRON,
    destination,
    headers: {
      'Content-Type': 'application/json',
    },
    label: TASK_DISPATCH_SCHEDULE_ID,
    method: 'POST',
    scheduleId: TASK_DISPATCH_SCHEDULE_ID,
  });

  log(
    'Ensured task dispatch schedule id=%s cron=%s destination=%s',
    TASK_DISPATCH_SCHEDULE_ID,
    TASK_DISPATCH_CRON,
    destination,
  );
};
