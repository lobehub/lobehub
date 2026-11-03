import { lambdaClient } from '@/libs/trpc/client';

class GenerationService {
  async getGenerationStatus(generationId: string, asyncTaskId: string) {
    return lambdaClient.generation.getGenerationStatus.query({ asyncTaskId, generationId });
  }

  /**
   * Delete a single generation
   */
  async deleteGeneration(generationId: string) {
    return lambdaClient.generation.deleteGeneration.mutate({ generationId });
  }
}

export const generationService = new GenerationService();
