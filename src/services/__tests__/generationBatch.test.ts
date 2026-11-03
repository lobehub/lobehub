import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { generationBatchService } from '../generationBatch';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    generationBatch: {
      getGenerationBatches: { query: vi.fn() },
      deleteGenerationBatch: { mutate: vi.fn() },
    },
  },
}));

describe('GenerationBatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getGenerationBatches should call lambdaClient with correct params', async () => {
    const topicId = 'test-topic-id';

    await generationBatchService.getGenerationBatches(topicId);

    expect(lambdaClient.generationBatch.getGenerationBatches.query).toBeCalledWith({ topicId });
  });

  it('deleteGenerationBatch should call lambdaClient with correct params', async () => {
    const batchId = 'test-batch-id';

    await generationBatchService.deleteGenerationBatch(batchId);

    expect(lambdaClient.generationBatch.deleteGenerationBatch.mutate).toBeCalledWith({ batchId });
  });
});
