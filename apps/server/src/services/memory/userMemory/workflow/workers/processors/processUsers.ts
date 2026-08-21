import type { Job } from 'bullmq';

import { processUsersHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/processUsers';

import { createLocalWorkflowContext } from '../context';

export const processUsersProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return processUsersHandler(context as any);
};
