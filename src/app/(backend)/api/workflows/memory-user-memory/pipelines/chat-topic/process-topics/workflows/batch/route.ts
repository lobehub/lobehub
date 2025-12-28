import { serve } from '@upstash/workflow/nextjs';

import {
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

import { orchestratorWorkflow } from '../workflows';

export const { POST } = serve<MemoryExtractionPayloadInput>(async (context) => {
  const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

  console.log('[chat-topic][batch] Starting batch topic processing workflow', {
    topicIds: payload.topicIds,
    userIds: payload.userIds,
  });

  const { body, isCanceled, isFailed } = await context.invoke('memory:user-memory:extract:topics:batch', {
    body: context.requestPayload,
    workflow: orchestratorWorkflow,
  });

  console.log('[chat-topic][batch] Batch topic processing workflow invoked', {
    body,
    isCanceled,
    isFailed,
  });

  return {
    processedTopics: payload.topicIds.length,
    processedUsers: payload.userIds.length,
  };
});
