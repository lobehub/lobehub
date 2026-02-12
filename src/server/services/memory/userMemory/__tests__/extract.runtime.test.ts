import { type AiProviderRuntimeState } from '@lobechat/types';
import { type EnabledAiModel } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { type MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import { MemoryExtractionExecutor } from '../extract';

const createRuntimeState = (models: EnabledAiModel[], keyVaults: Record<string, any>) =>
  ({
    enabledAiModels: models,
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
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
});
