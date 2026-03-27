import { ModelRuntime } from '@lobechat/model-runtime';
import { type AiProviderRuntimeState } from '@lobechat/types';
import { type EnabledAiModel } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { type MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import { MemoryExtractionExecutor, resolveRuntimeAgentConfig } from '../extract';

const createRuntimeState = (models: EnabledAiModel[], keyVaults: Record<string, any>) =>
  ({
    enabledAiModels: models,
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: Object.fromEntries(
      Object.entries(keyVaults).map(([providerId, vault]) => [
        providerId,
        { config: {}, keyVaults: vault, settings: {} },
      ]),
    ),
  }) as AiProviderRuntimeState;

const createExecutor = (privateOverrides?: Partial<MemoryExtractionPrivateConfig>) => {
  const basePrivateConfig: MemoryExtractionPrivateConfig = {
    agentGateKeeper: { model: 'gate-2', provider: 'provider-b' },
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

  const serverConfig = {
    aiProvider: {},
    memory: {},
  };

  // @ts-ignore accessing private constructor for testing
  return new MemoryExtractionExecutor(serverConfig as any, {
    ...basePrivateConfig,
    ...privateOverrides,
  });
};

describe('MemoryExtractionExecutor.resolveRuntimeKeyVaults', () => {
  it('prefers configured providers/models for gatekeeper, embedding, and layer extractors', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-c', 'provider-a'],
      agentGateKeeperPreferredModels: ['model-chat-1', 'vendor-prefix/model-chat-1'],
      agentGateKeeperPreferredProviders: ['provider-c', 'provider-a'],
      agentLayerExtractorPreferredProviders: ['provider-c', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-a',
        },
        {
          abilities: {},
          enabled: true,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-e',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-chat-1',
          type: 'chat',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-embedding-1',
          type: 'embedding',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-c',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-c',
        },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
        'provider-c': { apiKey: 'c-key' },
        'provider-e': { apiKey: 'e-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
      'provider-e': { apiKey: 'e-key' },
    });
  });

  it('warns and falls back to server provider when no enabled provider satisfies embedding model', async () => {
    const executor = createExecutor();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-a',
        },
        {
          abilities: {},
          enabled: true,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-e',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-chat-1',
          type: 'chat',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: true,
          id: 'vendor-prefix/model-embedding-1',
          type: 'embedding',
          providerId: 'provider-b',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-chat-1',
          type: 'chat',
          providerId: 'provider-c',
        },
        {
          abilities: {},
          enabled: false,
          id: 'model-embedding-1',
          type: 'embedding',
          providerId: 'provider-c',
        },
      ],
      {
        'provider-b': { apiKey: 'b-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' },
      'provider-l': { apiKey: 'l-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-e');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('ignores disabled providers when resolving key vaults', async () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-disabled', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: false,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-disabled',
        },
        {
          abilities: {},
          enabled: true,
          id: 'embed-1',
          type: 'embedding',
          providerId: 'provider-a',
        },
      ],
      {
        'provider-disabled': { apiKey: 'disabled-key' },
        'provider-a': { apiKey: 'a-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-disabled');
  });

  it('respects preferred provider order when multiple providers have the model', async () => {
    const executor = createExecutor({
      agentGateKeeper: {
        model: 'gate-2',
        provider: 'provider-a', // fallback provider differs from preferred order
        apiKey: 'sys-a-key',
        baseURL: 'https://api-a.example.com',
        language: 'English',
      },
      agentGateKeeperPreferredProviders: ['provider-b', 'provider-a'],
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'provider-a' },
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'provider-b' },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' }, // picks first preferred provider
    });
    expect(keyVaults).not.toHaveProperty('provider-a');
  });

  it('uses configured embedding provider vault directly even when preferred providers point elsewhere', async () => {
    const executor = createExecutor({
      embedding: { model: 'text-embedding-3-small', provider: 'openai' },
      embeddingPreferredProviders: ['provider-e'],
    });

    const runtimeState = createRuntimeState(
      [
        {
          abilities: {},
          enabled: true,
          id: 'text-embedding-3-small',
          type: 'embedding',
          providerId: 'provider-e',
        },
      ],
      {
        openai: { apiKey: 'openai-key', baseURL: 'https://api.openai.com/v1' },
        'provider-e': { apiKey: 'provider-e-key' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      openai: { apiKey: 'openai-key', baseURL: 'https://api.openai.com/v1' },
    });
  });

  it('uses configured gatekeeper and layer provider vaults directly when available', async () => {
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'openai' },
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
        provider: 'openai',
      },
      embedding: { model: 'text-embedding-3-small', provider: 'zhipu' },
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, enabled: true, id: 'gate-2', type: 'chat', providerId: 'zhipu' },
        { abilities: {}, enabled: true, id: 'layer-1', type: 'chat', providerId: 'zhipu' },
      ],
      {
        openai: { apiKey: 'openai-key', baseURL: 'https://api.openai.com/v1' },
        zhipu: { apiKey: 'zhipu-key', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
      },
    );

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      openai: { apiKey: 'openai-key', baseURL: 'https://api.openai.com/v1' },
      zhipu: { apiKey: 'zhipu-key', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
    });
  });

  it('falls back to configured provider when no enabled models match', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const executor = createExecutor({
      agentGateKeeper: { model: 'gate-2', provider: 'provider-fallback', apiKey: 'sys-fb-key' },
    });

    const runtimeState = createRuntimeState([], {
      'provider-fallback': { apiKey: 'fb-key' },
    });

    const keyVaults = await (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-fallback': { apiKey: 'fb-key' },
    });

    warnSpy.mockRestore();
  });

  it('does not clamp embedding context limit to openai threshold for non-openai providers', async () => {
    const executor = createExecutor({
      agentLayerExtractor: {
        contextLimit: 16000,
        layers: {
          activity: 'layer-act',
          context: 'layer-ctx',
          experience: 'layer-exp',
          identity: 'layer-id',
          preference: 'layer-pref',
        },
        model: 'layer-1',
        provider: 'openai',
      },
      embedding: {
        contextLimit: 16000,
        model: 'embedding-3',
        provider: 'zhipu',
      },
    });

    expect((executor as any).embeddingContextLimit).toBe(16000);
  });
});

describe('resolveRuntimeAgentConfig', () => {
  it('prefers direct providers when lobehub is configured but user has direct provider keys', async () => {
    const initializeWithProviderSpy = vi
      .spyOn(ModelRuntime, 'initializeWithProvider')
      .mockResolvedValue({} as any);

    await resolveRuntimeAgentConfig(
      { model: 'gpt-5-mini', provider: 'lobehub' },
      { openai: { apiKey: 'sk-openai' } },
      { userId: 'user-1' },
    );

    expect(initializeWithProviderSpy).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        apiKey: 'sk-openai',
        userId: 'user-1',
      }),
    );

    initializeWithProviderSpy.mockRestore();
  });

  it('falls back to openai when lobehub is configured but no direct provider key is available', async () => {
    const initializeWithProviderSpy = vi
      .spyOn(ModelRuntime, 'initializeWithProvider')
      .mockResolvedValue({} as any);

    await resolveRuntimeAgentConfig(
      { apiKey: 'sk-system', model: 'gpt-5-mini', provider: 'lobehub' },
      {},
      { userId: 'user-1' },
    );

    expect(initializeWithProviderSpy).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        apiKey: 'sk-system',
        userId: 'user-1',
      }),
    );

    initializeWithProviderSpy.mockRestore();
  });

  it('does not switch to unrelated provider from other key vault entries', async () => {
    const initializeWithProviderSpy = vi
      .spyOn(ModelRuntime, 'initializeWithProvider')
      .mockResolvedValue({} as any);

    await resolveRuntimeAgentConfig(
      { apiKey: 'sk-system-openai', model: 'gpt-5-mini', provider: 'openai' },
      { zhipu: { apiKey: 'zhipu-key', baseURL: 'https://open.bigmodel.cn/api/paas/v4' } },
      { userId: 'user-1' },
    );

    expect(initializeWithProviderSpy).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        apiKey: 'sk-system-openai',
        userId: 'user-1',
      }),
    );

    initializeWithProviderSpy.mockRestore();
  });

  it('supports legacy user vault key field for apiKey', async () => {
    const initializeWithProviderSpy = vi
      .spyOn(ModelRuntime, 'initializeWithProvider')
      .mockResolvedValue({} as any);

    await resolveRuntimeAgentConfig(
      { model: 'gpt-5-mini', provider: 'openai' },
      { openai: { endpoint: 'https://api.openai.com/v1', key: 'legacy-openai-key' } as any },
      { userId: 'user-1' },
    );

    expect(initializeWithProviderSpy).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        apiKey: 'legacy-openai-key',
        baseURL: 'https://api.openai.com/v1',
        userId: 'user-1',
      }),
    );

    initializeWithProviderSpy.mockRestore();
  });
});
