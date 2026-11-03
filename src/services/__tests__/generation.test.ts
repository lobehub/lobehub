import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { generationService } from '../generation';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    generation: {
      getGenerationStatus: { query: vi.fn() },
      deleteGeneration: { mutate: vi.fn() },
    },
  },
}));

describe('GenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getGenerationStatus should call lambdaClient with correct params', async () => {
    const generationId = 'test-generation-id';
    const asyncTaskId = 'test-async-task-id';

    await generationService.getGenerationStatus(generationId, asyncTaskId);

    expect(lambdaClient.generation.getGenerationStatus.query).toBeCalledWith({
      generationId,
      asyncTaskId,
    });
  });

  it('deleteGeneration should call lambdaClient with correct params', async () => {
    const generationId = 'test-generation-id';

    await generationService.deleteGeneration(generationId);

    expect(lambdaClient.generation.deleteGeneration.mutate).toBeCalledWith({ generationId });
  });
});
