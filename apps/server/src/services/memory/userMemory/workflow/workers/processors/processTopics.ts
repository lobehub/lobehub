import type { Job } from 'bullmq';

import { processTopicsHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/processTopics';

import { createLocalWorkflowContext } from '../context';

export const processTopicsProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return processTopicsHandler(context as any);
};
