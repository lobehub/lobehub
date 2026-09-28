import type { LobeChatDatabase } from '@lobechat/database';
import { ModelRuntime } from '@lobechat/model-runtime';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractorRunOptions, MemoryExtractionJob } from '../types';
import { MemoryExtractionService } from './extractExecutor';

const createService = () =>
  new MemoryExtractionService({
    config: {
      gateModel: 'glm-5',
      layerModels: {
        [LayersEnum.Activity]: 'glm-5',
        [LayersEnum.Context]: 'glm-5',
        [LayersEnum.Experience]: 'glm-5',
        [LayersEnum.Identity]: 'glm-5',
        [LayersEnum.Preference]: 'glm-5',
      },
    },
    db: {} as LobeChatDatabase,
    runtimes: {
      gatekeeper: ModelRuntime.initializeWithProvider('opencodecodingplan', { apiKey: 'test' }),
      layerExtractor: ModelRuntime.initializeWithProvider('opencodecodingplan', { apiKey: 'test' }),
    },
  });

const createJob = (sourceId: string, source = MemorySourceType.ChatTopic): MemoryExtractionJob => ({
  source,
  sourceId,
  userId: 'user-1',
});

const createOptions = (): ExtractorRunOptions<unknown> => ({
  contextProvider: { buildContext: vi.fn() },
  retrievedContexts: ['A conversation about a project.'],
});

describe('MemoryExtractionService session affinity', () => {
  const sessions: (string | null)[] = [];

  beforeEach(() => {
    sessions.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === 'https://models.dev/api.json') {
          return Response.json({ 'opencode-go': { models: {} } });
        }
        expect(String(url)).toBe('https://opencode.ai/zen/go/v1/chat/completions');
        sessions.push(new Headers(init?.headers).get('x-opencode-session'));
        const body = JSON.parse(String(init?.body));
        const schemaName = body.response_format.json_schema.name;
        const result =
          schemaName === 'gatekeeper_decision'
            ? Object.fromEntries(
                Object.values(LayersEnum).map((layer) => [
                  layer,
                  { reasoning: 'Extract', shouldExtract: true },
                ]),
              )
            : schemaName === 'identity_extraction'
              ? { add: [], remove: [], update: [] }
              : { memories: [] };
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(result), role: 'assistant' },
            },
          ],
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares the source topic across gatekeeper, all layers and recreated runtimes', async () => {
    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      const result = await createService().run(createJob('source-that-must-not-be-inferred'), {
        ...createOptions(),
        taskId: 'memory-task',
        topicId,
      });
      expect(result?.layers).toHaveLength(5);
      expect(Object.values(result!.processedErrorsCount)).toEqual([0, 0, 0, 0, 0]);
    }

    expect(sessions).toEqual([
      ...Array.from({ length: 12 }).fill('topic-1'),
      ...Array.from({ length: 6 }).fill('topic-2'),
    ]);
  });

  it('allocates one ID per topicless extraction, even when reusing the service', async () => {
    const service = createService();
    for (const sourceId of ['source-1', 'source-2']) {
      const result = await service.run(
        createJob(sourceId, MemorySourceType.BenchmarkLocomo),
        createOptions(),
      );
      expect(result?.layers).toHaveLength(5);
    }

    expect(sessions).toHaveLength(12);
    expect(sessions[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(sessions.slice(0, 6)).toEqual(Array.from({ length: 6 }).fill(sessions[0]));
    expect(sessions.slice(6)).toEqual(Array.from({ length: 6 }).fill(sessions[6]));
    expect(sessions[0]).not.toBe(sessions[6]);
  });

  it('reuses an explicit task ID across repeated invocations with fresh runtimes', async () => {
    for (let i = 0; i < 2; i++) {
      await createService().run(createJob('source-1', MemorySourceType.BenchmarkLocomo), {
        ...createOptions(),
        taskId: 'extraction-task-1',
      });
    }

    expect(sessions).toEqual(Array.from({ length: 12 }).fill('extraction-task-1'));
  });
});
