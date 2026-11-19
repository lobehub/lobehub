import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { type UpdateTopicValue } from '@/server/routers/lambda/generationTopic';

import { ServerService } from '../generationTopic';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    generationTopic: {
      getAllGenerationTopics: { query: vi.fn() },
      createTopic: { mutate: vi.fn() },
      updateTopic: { mutate: vi.fn() },
      updateTopicCover: { mutate: vi.fn() },
      deleteTopic: { mutate: vi.fn() },
    },
  },
}));

describe('GenerationTopic ServerService', () => {
  let service: ServerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ServerService();
  });

  it('getAllGenerationTopics should call lambdaClient', async () => {
    await service.getAllGenerationTopics();
    expect(lambdaClient.generationTopic.getAllGenerationTopics.query).toHaveBeenCalled();
  });

  it('createTopic should call lambdaClient with undefined', async () => {
    await service.createTopic();
    expect(lambdaClient.generationTopic.createTopic.mutate).toHaveBeenCalledWith(undefined);
  });

  it('createTopic should pass type, visibility, and title to lambdaClient', async () => {
    await service.createTopic('image', 'public', 'A mountain lake at sunrise');
    expect(lambdaClient.generationTopic.createTopic.mutate).toHaveBeenCalledWith({
      title: 'A mountain lake at sunrise',
      type: 'image',
      visibility: 'public',
    });
  });

  it('updateTopic should call lambdaClient with correct params', async () => {
    const id = 'test-topic-id';
    const data: UpdateTopicValue = {
      title: 'Updated Topic',
    };

    await service.updateTopic(id, data);

    expect(lambdaClient.generationTopic.updateTopic.mutate).toHaveBeenCalledWith({
      id,
      value: data,
    });
  });

  it('updateTopicCover should call lambdaClient with correct params', async () => {
    const id = 'test-topic-id';
    const coverUrl = 'https://example.com/cover.jpg';

    await service.updateTopicCover(id, coverUrl);

    expect(lambdaClient.generationTopic.updateTopicCover.mutate).toHaveBeenCalledWith({
      id,
      coverUrl,
    });
  });

  it('deleteTopic should call lambdaClient with correct params', async () => {
    const id = 'test-topic-id';

    await service.deleteTopic(id);

    expect(lambdaClient.generationTopic.deleteTopic.mutate).toHaveBeenCalledWith({ id });
  });
});
