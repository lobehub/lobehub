import type { Job } from 'bullmq';

import { processUserTopicsHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/processUserTopics';

import { createLocalWorkflowContext } from '../context';

export const processUserTopicsProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return processUserTopicsHandler(context as any);
};
