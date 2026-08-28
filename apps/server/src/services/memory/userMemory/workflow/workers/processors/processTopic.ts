import type { Job } from 'bullmq';

import { processTopicHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/processTopic';

import { createLocalWorkflowContext } from '../context';

export const processTopicProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return processTopicHandler(context as any);
};
