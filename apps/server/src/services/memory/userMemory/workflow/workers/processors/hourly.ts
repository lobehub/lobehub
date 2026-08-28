import type { Job } from 'bullmq';

import { hourlyWorkflowHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/hourly';

import { createLocalWorkflowContext } from '../context';

export const hourlyProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return hourlyWorkflowHandler(context as any);
};
