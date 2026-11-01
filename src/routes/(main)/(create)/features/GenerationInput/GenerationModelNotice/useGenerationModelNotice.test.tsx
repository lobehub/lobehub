import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveGenerationModelNotice,
  useImageGenerationModelNotice,
  useVideoGenerationModelNotice,
} from './useGenerationModelNotice';

interface TestModel {
  id: string;
}

interface TestProviderWithModels {
  children: TestModel[];
  id: string;
}

const testState = vi.hoisted(() => ({
  aiInfra: {
    enabledImageModelList: [] as TestProviderWithModels[],
    enabledVideoModelList: [] as TestProviderWithModels[],
    isInitAiProviderRuntimeState: false,
  },
  // Mirrors the buggy default: falls back to the Google provider even when Google
  // is disabled (lobehub/lobehub#17400).
  image: { model: 'gemini-3.1-flash-image-preview:image', provider: 'google' },
  video: { model: 'veo-3.1', provider: 'google' },
}));

type StoreSelector<T = unknown, S = Record<PropertyKey, unknown>> = (state: S) => T;

vi.mock('@/store/image', () => ({
  useImageStore: <T,>(selector: StoreSelector<T, typeof testState.image>) =>
    selector(testState.image),
}));

vi.mock('@/store/image/selectors', () => ({
  imageGenerationConfigSelectors: {
    model: (s: typeof testState.image) => s.model,
    provider: (s: typeof testState.image) => s.provider,
  },
}));

vi.mock('@/store/video', () => ({
  useVideoStore: <T,>(selector: StoreSelector<T, typeof testState.video>) =>
    selector(testState.video),
}));

vi.mock('@/store/video/selectors', () => ({
  videoGenerationConfigSelectors: {
    model: (s: typeof testState.video) => s.model,
    provider: (s: typeof testState.video) => s.provider,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (s: typeof testState.aiInfra) => s.enabledImageModelList,
    enabledVideoModelList: (s: typeof testState.aiInfra) => s.enabledVideoModelList,
    isInitAiProviderRuntimeState: (s: typeof testState.aiInfra) => s.isInitAiProviderRuntimeState,
  },
  useAiInfraStore: <T,>(selector: StoreSelector<T, typeof testState.aiInfra>) =>
    selector(testState.aiInfra),
}));

describe('resolveGenerationModelNotice', () => {
  it('does not return a notice before the model runtime config is ready', () => {
    expect(
      resolveGenerationModelNotice({
        enabledModelList: [],
        isModelConfigReady: false,
        model: 'gemini-3.1-flash-image-preview:image',
        provider: 'google',
      }),
    ).toBeUndefined();
  });

  it('does not return a notice when the current model is present in the enabled list', () => {
    expect(
      resolveGenerationModelNotice({
        enabledModelList: [{ children: [{ id: 'gpt-image-1' }], id: 'openai' }],
        isModelConfigReady: true,
        model: 'gpt-image-1',
        provider: 'openai',
      }),
    ).toBeUndefined();
  });

  it('returns providerDisabled when the provider group is absent from the enabled list', () => {
    expect(
      resolveGenerationModelNotice({
        enabledModelList: [{ children: [{ id: 'gpt-image-1' }], id: 'openai' }],
        isModelConfigReady: true,
        model: 'gemini-3.1-flash-image-preview:image',
        provider: 'google',
      }),
    ).toEqual({ key: 'notice.providerDisabled', provider: 'google', type: 'warning' });
  });

  it('returns modelRemoved when the provider exists but the model is not among its children', () => {
    expect(
      resolveGenerationModelNotice({
        enabledModelList: [{ children: [{ id: 'gemini-2.5-flash-image' }], id: 'google' }],
        isModelConfigReady: true,
        model: 'gemini-3.1-flash-image-preview:image',
        provider: 'google',
      }),
    ).toEqual({ key: 'notice.modelRemoved', provider: 'google', type: 'warning' });
  });
});

describe('useImageGenerationModelNotice', () => {
  beforeEach(() => {
    testState.aiInfra.enabledImageModelList = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
    testState.image = { model: 'gemini-3.1-flash-image-preview:image', provider: 'google' };
  });

  it('does not flag the model before the model runtime config is ready', () => {
    const { result } = renderHook(() => useImageGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(false);
    expect(result.current.notice).toBeUndefined();
  });

  it('does not flag the model when the current model is in the enabled list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledImageModelList = [
      { children: [{ id: 'gemini-3.1-flash-image-preview:image' }], id: 'google' },
    ];

    const { result } = renderHook(() => useImageGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(false);
    expect(result.current.notice).toBeUndefined();
  });

  it('flags providerDisabled when the disabled google default provider is absent from the enabled list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledImageModelList = [{ children: [{ id: 'gpt-image-1' }], id: 'openai' }];

    const { result } = renderHook(() => useImageGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.notice).toEqual({
      key: 'notice.providerDisabled',
      provider: 'google',
      type: 'warning',
    });
  });

  it('flags modelRemoved when the provider is enabled but no longer lists the model', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledImageModelList = [
      { children: [{ id: 'gemini-2.5-flash-image' }], id: 'google' },
    ];

    const { result } = renderHook(() => useImageGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.notice).toEqual({
      key: 'notice.modelRemoved',
      provider: 'google',
      type: 'warning',
    });
  });
});

describe('useVideoGenerationModelNotice', () => {
  beforeEach(() => {
    testState.aiInfra.enabledVideoModelList = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
    testState.video = { model: 'veo-3.1', provider: 'google' };
  });

  it('does not flag the model before the model runtime config is ready', () => {
    const { result } = renderHook(() => useVideoGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(false);
    expect(result.current.notice).toBeUndefined();
  });

  it('does not flag the model when the current model is in the enabled list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledVideoModelList = [{ children: [{ id: 'veo-3.1' }], id: 'google' }];

    const { result } = renderHook(() => useVideoGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(false);
    expect(result.current.notice).toBeUndefined();
  });

  it('flags providerDisabled when the provider group is absent from the enabled list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledVideoModelList = [{ children: [{ id: 'kling-v2' }], id: 'fal' }];

    const { result } = renderHook(() => useVideoGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.notice).toEqual({
      key: 'notice.providerDisabled',
      provider: 'google',
      type: 'warning',
    });
  });

  it('flags modelRemoved when the provider is enabled but no longer lists the model', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledVideoModelList = [{ children: [{ id: 'veo-2' }], id: 'google' }];

    const { result } = renderHook(() => useVideoGenerationModelNotice());

    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.notice).toEqual({
      key: 'notice.modelRemoved',
      provider: 'google',
      type: 'warning',
    });
  });
});
