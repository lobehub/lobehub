import type { LobeChatDatabase } from '@lobechat/database';
import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractorRunOptions, MemoryExtractionJob } from '../types';
import { MemoryExtractionService } from './extractExecutor';

const gatekeeperDecision = {
  activity: { reasoning: 'not needed', shouldExtract: false },
  context: { reasoning: 'extract context', shouldExtract: true },
  experience: { reasoning: 'not needed', shouldExtract: false },
  identity: { reasoning: 'not needed', shouldExtract: false },
  preference: { reasoning: 'not needed', shouldExtract: false },
};

const job: MemoryExtractionJob = {
  source: MemorySourceType.ChatTopic,
  sourceId: 'source-that-must-not-be-inferred',
  userId: 'user-that-must-not-be-inferred',
};

const buildOptions = (topicId?: string): ExtractorRunOptions<never> => ({
  contextProvider: {
    buildContext: vi.fn(),
  },
  retrievedContexts: ['conversation'],
  topicId,
});

describe('MemoryExtractionService topic metadata', () => {
  const generateObject = vi.fn(
    async (payload: GenerateObjectPayload, _options?: { metadata: Record<string, unknown> }) =>
      payload.schema?.name === 'gatekeeper_decision' ? gatekeeperDecision : { memories: [] },
  );
  const runtime = { generateObject } as unknown as ModelRuntime;
  const service = new MemoryExtractionService<never>({
    config: {
      gateModel: 'gate-model',
      layerModels: {
        [LayersEnum.Activity]: 'layer-model',
        [LayersEnum.Context]: 'layer-model',
        [LayersEnum.Experience]: 'layer-model',
        [LayersEnum.Identity]: 'layer-model',
        [LayersEnum.Preference]: 'layer-model',
      },
    },
    db: {} as LobeChatDatabase,
    runtimes: { gatekeeper: runtime, layerExtractor: runtime },
  });

  beforeEach(() => {
    generateObject.mockClear();
  });

  it('keeps each optional topic scoped to its gatekeeper and layer calls on a shared runtime', async () => {
    await service.run(job, buildOptions('topic-a'));
    await service.run(job, buildOptions('topic-b'));
    await service.run(job, buildOptions());

    expect(generateObject).toHaveBeenCalledTimes(6);
    const taskId = generateObject.mock.calls[4][1]?.metadata.taskId;
    expect(taskId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(generateObject.mock.calls.map(([, options]) => options?.metadata)).toEqual([
      { topicId: 'topic-a', trigger: 'memory' },
      { topicId: 'topic-a', trigger: 'memory' },
      { topicId: 'topic-b', trigger: 'memory' },
      { topicId: 'topic-b', trigger: 'memory' },
      { taskId, trigger: 'memory' },
      { taskId, trigger: 'memory' },
    ]);
  });
});
