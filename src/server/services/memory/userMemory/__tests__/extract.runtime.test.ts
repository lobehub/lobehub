import type { AiProviderRuntimeState } from '@lobechat/types';
import type { EnabledAiModel } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import type { MemoryExtractionPrivateConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

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

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore accessing private constructor for testing
  return new MemoryExtractionExecutor(serverConfig as any, {
    ...basePrivateConfig,
    ...privateOverrides,
  });
};

describe('MemoryExtractionExecutor.resolveRuntimeKeyVaults', () => {
  it('prefers configured providers/models for gatekeeper, embedding, and layer extractors', () => {
    const executor = createExecutor({
      embeddingPreferredProviders: ['provider-e'],
      agentGateKeeperPreferredModels: ['gate-1'],
      agentGateKeeperPreferredProviders: ['provider-a', 'provider-b'],
      agentLayerExtractorPreferredProviders: ['provider-l'],
    });

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, id: 'gate-1', providerId: 'provider-a', type: 'chat' },
        { abilities: {}, id: 'gate-2', providerId: 'provider-b', type: 'chat' },
        { abilities: {}, id: 'embed-1', providerId: 'provider-e', type: 'embedding' },
        { abilities: {}, id: 'layer-ctx', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-act', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-exp', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-id', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-pref', providerId: 'provider-l', type: 'chat' },
      ],
      {
        'provider-a': { apiKey: 'a-key' },
        'provider-b': { apiKey: 'b-key' },
        'provider-e': { apiKey: 'e-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const keyVaults = (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-a': { apiKey: 'a-key' }, // gatekeeper picked preferred provider/model
      'provider-e': { apiKey: 'e-key' }, // embedding honored preferred provider
      'provider-l': { apiKey: 'l-key' }, // layer extractor models resolved
    });
  });

  it('warns and falls back to server provider when no enabled provider satisfies embedding model', () => {
    const executor = createExecutor();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const runtimeState = createRuntimeState(
      [
        { abilities: {}, id: 'gate-2', providerId: 'provider-b', type: 'chat' },
        { abilities: {}, id: 'layer-act', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-ctx', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-exp', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-id', providerId: 'provider-l', type: 'chat' },
        { abilities: {}, id: 'layer-pref', providerId: 'provider-l', type: 'chat' },
      ],
      {
        'provider-b': { apiKey: 'b-key' },
        'provider-l': { apiKey: 'l-key' },
      },
    );

    const keyVaults = (executor as any).resolveRuntimeKeyVaults(runtimeState);

    expect(keyVaults).toMatchObject({
      'provider-b': { apiKey: 'b-key' },
      'provider-l': { apiKey: 'l-key' },
    });
    expect(keyVaults).not.toHaveProperty('provider-e');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
