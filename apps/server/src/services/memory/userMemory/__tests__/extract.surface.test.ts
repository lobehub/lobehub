// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { LayersEnum, MemorySourceType } from '@/types/userMemory';

import * as extractModule from '../extract';
import { MemoryExtractionExecutor, MemoryExtractionWorkflowService } from '../extract';

const privateConfig: MemoryExtractionPrivateConfig = {
  agentBenchmarkLoCoMo: { model: 'benchmark-1', provider: 'provider-b' },
  agentGateKeeper: { model: 'gate-1', provider: 'provider-g' },
  agentLayerExtractor: {
    contextLimit: 2048,
    layers: {
      activity: 'layer-act',
      context: 'layer-ctx',
      experience: 'layer-exp',
      identity: 'layer-id',
      preference: 'layer-pref',
    },
    model: 'layer-1',
    provider: 'provider-l',
  },
  agentPersonaWriter: { model: 'persona-1', provider: 'provider-s' },
  concurrency: 1,
  embedding: { model: 'embed-1', provider: 'provider-e' },
  featureFlags: { enableBenchmarkLoCoMo: false },
  observabilityS3: { enabled: false },
  webhook: {},
};

const createExecutor = () =>
  // @ts-ignore accessing private constructor for testing
  new MemoryExtractionExecutor({ aiProvider: {}, memory: {} } as any, privateConfig);

const functionMembers = (target: object) =>
  Object.getOwnPropertyNames(target)
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof (target as Record<string, unknown>)[name] === 'function')
    .sort();

const job = {
  source: MemorySourceType.ChatTopic,
  sourceId: 'topic-1',
  userId: 'user-1',
} as any;

const memoryServiceConfig = {
  embeddingContextLimit: 1024,
  modelConfig: { embeddingsModel: 'embed-1' },
} as any;

const runtimes = { embeddings: { id: 'embeddings-runtime' } } as any;

const persistExtraction = (executor: MemoryExtractionExecutor, outputs: Record<string, unknown>) =>
  (executor as any).persistExtraction(
    job,
    ['message-1'],
    { outputs },
    runtimes,
    memoryServiceConfig,
    { id: 'db' },
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extract module surface', () => {
  it('keeps the module runtime exports', () => {
    expect(Object.keys(extractModule).sort()).toEqual([
      'MemoryExtractionExecutor',
      'MemoryExtractionWorkflowService',
      'buildWorkflowPayloadInput',
      'makeTaskErrorItem',
      'memoryExtractionPayloadSchema',
      'normalizeMemoryExtractionPayload',
      'resolveRuntimeAgentConfig',
    ]);
  });

  it('keeps the executor prototype and static members', () => {
    expect(functionMembers(MemoryExtractionExecutor.prototype)).toEqual([
      'buildBaseMetadata',
      'countTokens',
      'extractBenchmarkSource',
      'extractTopic',
      'filterTopicIdsForUser',
      'generateEmbeddings',
      'getAiProviderRuntimeState',
      'getOnExtractHooksPath',
      'getRuntime',
      'getTopicsForUser',
      'getUsers',
      'getUsersForHourlyExtraction',
      'listConversationsForTopic',
      'listRelevantUserMemories',
      'listUserMemoryIdentities',
      'normalizeLayerError',
      'persistActivityMemories',
      'persistContextMemories',
      'persistExperienceMemories',
      'persistExtraction',
      'persistIdentityMemories',
      'persistPreferenceMemories',
      'recordJobMetrics',
      'recordLayerEntries',
      'reportUserInitiatedProgress',
      'resolveRuntimeKeyVaults',
      'resolveUserMemoryAgent',
      'resolveUserMemoryServiceConfig',
      'runDirect',
      'trimConversationsToTokenLimit',
      'trimTextToTokenLimit',
      'uploadExtractionTrace',
    ]);
    expect(functionMembers(MemoryExtractionExecutor)).toEqual(['create']);
    expect(functionMembers(MemoryExtractionWorkflowService)).toEqual([
      'getClient',
      'triggerConsolidation',
      'triggerHourly',
      'triggerHourlyTracked',
      'triggerPersonaUpdate',
      'triggerProcessTopic',
      'triggerProcessTopics',
      'triggerProcessUserTopics',
      'triggerProcessUsers',
    ]);
  });
});

describe('MemoryExtractionExecutor.runDirect', () => {
  const basePayload = {
    forceAll: false,
    forceTopics: false,
    layers: [LayersEnum.Context],
    sourceIds: [],
    sources: [MemorySourceType.ChatTopic],
    topicIds: ['topic-1', 'topic-2'],
    userIds: ['user-1'],
  } as any;

  it.each([
    [{ userIds: [] }, 'Direct execution requires at least one user id.'],
    [{ topicIds: [] }, 'Direct chat_topic execution requires topicIds.'],
    [
      { sources: [MemorySourceType.BenchmarkLocomo], topicIds: [] },
      'Direct benchmark_locomo execution requires sourceIds.',
    ],
  ])('rejects %o', async (override, message) => {
    await expect(createExecutor().runDirect({ ...basePayload, ...override })).rejects.toThrow(
      message,
    );
  });

  it('dispatches chat topics through the instance filter and extractTopic', async () => {
    const executor = createExecutor();
    const filter = vi.spyOn(executor, 'filterTopicIdsForUser').mockResolvedValue(['topic-2']);
    const extractTopic = vi
      .spyOn(executor, 'extractTopic')
      .mockResolvedValue({ extracted: true, layers: { contexts: 1 }, memoryIds: ['m-1'] } as any);

    await expect(executor.runDirect({ ...basePayload, workspaceId: 'ws-1' })).resolves.toEqual({
      processed: 1,
      results: [
        {
          extracted: true,
          layers: { contexts: 1 },
          memoryIds: ['m-1'],
          topicId: 'topic-2',
          userId: 'user-1',
        },
      ],
    });
    expect(filter).toHaveBeenCalledWith('user-1', ['topic-1', 'topic-2'], 'ws-1');
    expect(extractTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        layers: [LayersEnum.Context],
        source: MemorySourceType.ChatTopic,
        topicId: 'topic-2',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
  });
});

describe('MemoryExtractionExecutor.persistExtraction', () => {
  it('persists each layer through the instance and returns created ids per layer', async () => {
    const executor = createExecutor();
    const persistContext = vi
      .spyOn(executor, 'persistContextMemories')
      .mockResolvedValue({ errors: [], ids: ['c-1', 'c-2'] } as any);
    const persistIdentity = vi
      .spyOn(executor, 'persistIdentityMemories')
      .mockResolvedValue({ errors: [], ids: ['i-1'] } as any);
    const recordLayerEntries = vi.spyOn(executor as any, 'recordLayerEntries');

    await expect(
      persistExtraction(executor, {
        context: { data: { memories: ['context'] } },
        identity: { data: { memories: ['identity'] } },
      }),
    ).resolves.toEqual({
      createdIds: ['c-1', 'c-2', 'i-1'],
      layers: { [LayersEnum.Context]: 2, [LayersEnum.Identity]: 1 },
    });
    expect(persistContext).toHaveBeenCalledWith(
      job,
      ['message-1'],
      { memories: ['context'] },
      runtimes.embeddings,
      'embed-1',
      1024,
      { id: 'db' },
    );
    expect(persistIdentity).toHaveBeenCalledOnce();
    expect(recordLayerEntries).toHaveBeenCalledWith(job, LayersEnum.Context, 2);
    expect(recordLayerEntries).toHaveBeenCalledWith(job, LayersEnum.Identity, 1);
  });

  it('aggregates extract and persist errors into one thrown error', async () => {
    const executor = createExecutor();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(executor, 'persistPreferenceMemories').mockRejectedValue(new Error('db down'));

    await expect(
      persistExtraction(executor, {
        activity: { error: new Error('model refused') },
        preference: { data: { memories: [] } },
      }),
    ).rejects.toMatchObject({
      items: [
        expect.objectContaining({ layer: 'activities', stage: 'extract' }),
        expect.objectContaining({ layer: 'preferences', stage: 'persist' }),
      ],
      message:
        'Memory extraction encountered layer errors: [extract] activities: model refused; [persist] preferences: db down',
    });
  });
});
