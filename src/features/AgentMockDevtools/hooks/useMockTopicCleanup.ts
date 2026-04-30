import { useCallback } from 'react';

import { lambdaClient } from '@/libs/trpc/client/lambda';

export function useMockTopicCleanup() {
  return useCallback(async () => {
    if (process.env.NODE_ENV !== 'development') return { deleted: 0 };
    const result = await lambdaClient.topic.devClearMockTopics.mutate({});
    return result;
  }, []);
}
