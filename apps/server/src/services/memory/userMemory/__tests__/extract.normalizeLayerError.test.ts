import { LayersEnum } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { makeTaskErrorItem, MemoryExtractionExecutor } from '../extract';

const createExecutor = () => {
  const basePrivateConfig = {
    agentBenchmarkLoCoMo: { model: 'benchmark-1', provider: 'provider-b' },
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
  return new MemoryExtractionExecutor(serverConfig as any, basePrivateConfig);
};

describe('MemoryExtractionExecutor.normalizeLayerError', () => {
  const executor = createExecutor();

  const normalizeLayerError = (layer: LayersEnum, stage: 'extract' | 'persist', error: unknown) =>
    (executor as any).normalizeLayerError(layer, stage, error) as Error;

  it('should extract message from Error instances', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', new Error('test error'));
    expect(result.message).toBe('[extract] activities: test error');
  });

  it('should extract message from objects with .message string', () => {
    const result = normalizeLayerError(LayersEnum.Context, 'persist', { message: 'bad request' });
    expect(result.message).toBe('[persist] contexts: bad request');
  });

  it('should extract message from objects with .error string', () => {
    const result = normalizeLayerError(LayersEnum.Experience, 'extract', {
      error: 'rate limited',
    });
    expect(result.message).toBe('[extract] experiences: rate limited');
  });

  it('should extract message from objects with .detail string', () => {
    const result = normalizeLayerError(LayersEnum.Preference, 'extract', {
      detail: 'not found',
    });
    expect(result.message).toBe('[extract] preferences: not found');
  });

  it('should JSON.stringify objects with non-string .message', () => {
    const result = normalizeLayerError(LayersEnum.Identity, 'extract', {
      message: { code: 500, reason: 'internal' },
    });
    expect(result.message).toBe(
      '[extract] identities: {"code":500,"reason":"internal"}',
    );
  });

  it('should JSON.stringify objects with no known fields', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', { foo: 'bar' });
    expect(result.message).toBe('[extract] activities: {"foo":"bar"}');
  });

  it('should handle objects that throw on JSON.stringify (circular refs)', () => {
    const circular: any = {};
    circular.self = circular;
    const result = normalizeLayerError(LayersEnum.Context, 'extract', circular);
    // Should fallback to String(obj) which gives "[object Object]"
    expect(result.message).toBe('[extract] contexts: [object Object]');
  });

  it('should handle primitive string values', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', 'simple string error');
    expect(result.message).toBe('[extract] activities: simple string error');
  });

  it('should handle primitive number values', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', 42);
    expect(result.message).toBe('[extract] activities: 42');
  });

  it('should handle null', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', null);
    expect(result.message).toBe('[extract] activities: null');
  });

  it('should handle undefined', () => {
    const result = normalizeLayerError(LayersEnum.Activity, 'extract', undefined);
    expect(result.message).toBe('[extract] activities: undefined');
  });

  it('should prefix with [stage] and layer label for each layer', () => {
    const layers = [
      { enum: LayersEnum.Activity, label: 'activities' },
      { enum: LayersEnum.Context, label: 'contexts' },
      { enum: LayersEnum.Experience, label: 'experiences' },
      { enum: LayersEnum.Identity, label: 'identities' },
      { enum: LayersEnum.Preference, label: 'preferences' },
    ];

    for (const { enum: layer, label } of layers) {
      const extractResult = normalizeLayerError(layer, 'extract', 'err');
      expect(extractResult.message).toBe(`[extract] ${label}: err`);

      const persistResult = normalizeLayerError(layer, 'persist', 'err');
      expect(persistResult.message).toBe(`[persist] ${label}: err`);
    }
  });
});

describe('makeTaskErrorItem', () => {
  it('should create a task error item with correct structure', () => {
    const error = new Error('test error');
    const item = makeTaskErrorItem('extract', error, {
      layer: 'activities',
      sourceId: 'topic-123',
      sourceType: 'chat_topic' as any,
    });

    expect(item).toMatchObject({
      layer: 'activities',
      message: 'test error',
      name: 'Error',
      sourceId: 'topic-123',
      sourceType: 'chat_topic',
      stage: 'extract',
    });
  });
});
