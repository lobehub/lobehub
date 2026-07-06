import { type GenerationTopicItem } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import { type UpdateTopicValue } from '@/server/routers/lambda/generationTopic';
import { type ImageGenerationTopic } from '@/types/generation';

export class ServerService {
  async getAllGenerationTopics(type?: 'image' | 'video'): Promise<ImageGenerationTopic[]> {
    return lambdaClient.generationTopic.getAllGenerationTopics.query(type ? { type } : undefined);
  }

  async createTopic(type?: 'image' | 'video', visibility?: 'private' | 'public'): Promise<string> {
    return lambdaClient.generationTopic.createTopic.mutate(
      type || visibility ? { type, visibility } : undefined,
    );
  }

  async updateTopic(id: string, data: UpdateTopicValue): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.updateTopic.mutate({ id, value: data });
  }

  async updateTopicCover(id: string, coverUrl: string): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.updateTopicCover.mutate({ coverUrl, id });
  }

  async deleteTopic(id: string): Promise<GenerationTopicItem | undefined> {
    return lambdaClient.generationTopic.deleteTopic.mutate({ id });
  }

  async setTopicVisibility(id: string, visibility: 'private' | 'public'): Promise<void> {
    await lambdaClient.generationTopic.setTopicVisibility.mutate({ id, visibility });
  }
}

export const generationTopicService = new ServerService();
