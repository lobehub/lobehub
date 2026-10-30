import type { Job } from 'bullmq';

import { personaUpdateHandler } from '@/server/router-hono/workflows/memory-user-memory/workflows/personaUpdate';

import { createLocalWorkflowContext } from '../context';

export const personaUpdateProcessor = async (job: Job) => {
  const context = createLocalWorkflowContext(job);
  return personaUpdateHandler(context as any);
};
