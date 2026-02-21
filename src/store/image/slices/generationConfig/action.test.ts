import { act, renderHook } from '@testing-library/react';
import {
  type AIImageModelCard,
  type ModelParamsSchema,
  type RuntimeImageGenParams,
} from 'model-bank';
import { extractDefaultValues, fluxSchnellParamsSchema } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageStore } from '@/store/image';

const { currentImageSettingsMock } = vi.hoisted(() => ({
  currentImageSettingsMock: vi.fn(() => ({
    defaultImageNum: 4,
  })),
}));

vi.mock('@/store/user/slices/settings/selectors', () => ({
  settingsSelectors: {
    currentImageSettings: currentImageSettingsMock,
  },
}));

// Test fixtures
const customModelSchema: ModelParamsSchema = {
  prompt: { default: '' },
  width: { default: 1024, min: 256, max: 2048, step: 64 },
  height: { default: 1024, min: 256, max: 2048, step: 64 },
  steps: { default: 20, min: 1, max: 50 },
};

const testImageModels: AIImageModelCard[] = [
  {
    id: 'flux/schnell',
    displayName: 'FLUX.1 Schnell',
    type: 'image',
    parameters: fluxSchnellParamsSchema,
    releasedAt: '2024-08-01',
  },
  {
    id: 'custom-model',
    displayName: 'Custom Model',
    type: 'image',
    parameters: customModelSchema,
    releasedAt: '2024-01-01',
  },
];

const mockProviders = [
  {
    id: 'fal',
    name: 'Fal',
    children: [testImageModels[0]],
  },
  {
    id: 'custom-provider',
    name: 'Custom Provider',
    children: [testImageModels[1]],
  },
];

// Mock external dependencies
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: vi.fn(() => mockProviders),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

// Test data
const fluxSchnellDefaultValues = extractDefaultValues(fluxSchnellParamsSchema);
const customModelDefaultValues = extractDefaultValues(customModelSchema);

const initialTestState = {
  model: 'initial-model',
  provider: 'initial-provider',
  imageNum: 1,
  parameters: {
    prompt: 'initial prompt',
    width: 512,
    height: 512,
  } satisfies Partial<RuntimeImageGenParams>,
  parametersSchema: {
    prompt: { default: '' },
    width: { default: 512, min: 256, max: 1024 },
    height: { default: 512, min: 256, max: 1024 },
  } satisfies ModelParamsSchema,
};

beforeEach(() => {
  vi.clearAllMocks();
  currentImageSettingsMock.mockReturnValue({ defaultImageNum: 4 });
  useImageStore.setState(initialTestState);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationConfigAction', () => {
  // Helper function to create test parameters
  const createTestParameters = (overrides: Partial<RuntimeImageGenParams> = {}) =>
    ({
      prompt: '',
      width: 512,
      height: 512,
      ...overrides,
    }) satisfies Partial<RuntimeImageGenParams>;

  // Helper function to create test schema
  const createTestSchema = (overrides: Partial<ModelParamsSchema> = {}) =>
    ({
      prompt: { default: '' },
      width: { default: 512, min: 256, max: 2048 },
      height: { default: 512, min: 256, max: 2048 },
      ...overrides,
    }) satisfies ModelParamsSchema;

  describe('Parameter Management', () => {
    it('should update individual parameters via setParamOnInput', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('prompt', 'new test prompt');
      });

      expect(result.current.parameters).toMatchObject({
        prompt: 'new test prompt',
        width: 512,
        height: 512,
      });
    });

    it('should handle different parameter types (string, number, null, array)', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('width', 2048);
        result.current.setParamOnInput('seed', null);
        result.current.setParamOnInput('imageUrls', ['test1.jpg', 'test2.jpg']);
      });

      expect(result.current.parameters).toMatchObject({
        width: 2048,
        seed: null,
        imageUrls: ['test1.jpg', 'test2.jpg'],
      });
    });

    it('should update imageNum independently', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(4);
      });

      expect(result.current.imageNum).toBe(4);
    });

    it('should handle edge case values for imageNum', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setImageNum(0);
      });

      expect(result.current.imageNum).toBe(0);
    });
  });

  describe('Model and Provider Selection', () => {
    it('should set complete configuration for flux/schnell model', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('flux/schnell', 'fal');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);
      expect(result.current.parametersSchema).toEqual(fluxSchnellParamsSchema);
    });

    it('should handle custom model configuration', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setModelAndProviderOnSelect('custom-model', 'custom-provider');
      });

      expect(result.current.model).toBe('custom-model');
      expect(result.current.provider).toBe('custom-provider');
      expect(result.current.parameters).toEqual(customModelDefaultValues);
      expect(result.current.parametersSchema).toEqual(customModelSchema);
    });

    it('should completely replace parameters when switching models', () => {
      const { result } = renderHook(() => useImageStore());

      // Set some custom parameters
      act(() => {
        result.current.setParamOnInput('prompt', 'custom prompt');
        result.current.setParamOnInput('steps', 50);
      });

      // Switch model
      act(() => {
        result.current.setModelAndProviderOnSelect('flux/schnell', 'fal');
      });

      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);
      expect(result.current.parameters?.prompt).toBe('');
    });
  });

  describe('Settings Reuse', () => {
    it('should merge custom settings with model defaults', () => {
      const { result } = renderHook(() => useImageStore());
      const customSettings: Partial<RuntimeImageGenParams> = {
        prompt: 'custom prompt',
        steps: 8,
        seed: 54321,
      };

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', customSettings);
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual({
        ...fluxSchnellDefaultValues,
        ...customSettings,
      });
      expect(result.current.parametersSchema).toEqual(fluxSchnellParamsSchema);
    });

    it('should handle empty and null settings', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', {});
      });

      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);

      act(() => {
        result.current.reuseSettings('flux/schnell', 'fal', { seed: null, imageUrl: null });
      });

      expect(result.current.parameters?.seed).toBeNull();
      expect(result.current.parameters?.imageUrl).toBeNull();
    });

    it('should update only seed parameter via reuseSeed', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setParamOnInput('prompt', 'test prompt');
        result.current.reuseSeed(98765);
      });

      expect(result.current.parameters).toMatchObject({
        prompt: 'test prompt',
        width: 512,
        height: 512,
        seed: 98765,
      });
    });

    it('should handle edge case seed values', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.reuseSeed(0);
      });

      expect(result.current.parameters?.seed).toBe(0);

      const largeSeed = 2147483647;
      act(() => {
        result.current.reuseSeed(largeSeed);
      });

      expect(result.current.parameters?.seed).toBe(largeSeed);
    });
  });

  describe('Aspect Ratio and Dimension Control', () => {
    it('should update width without affecting height when aspect ratio is unlocked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: false,
      });

      act(() => {
        result.current.setWidth(1024);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 512,
      });
    });

    it('should update both dimensions when aspect ratio is locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: true,
        activeAspectRatio: '1:1',
      });

      act(() => {
        result.current.setWidth(1024);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 1024,
      });
    });

    it('should clamp dimensions to schema bounds when aspect ratio is locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema({
          height: { default: 512, min: 256, max: 1024 },
        }),
        isAspectRatioLocked: true,
        activeAspectRatio: '1:1',
      });

      act(() => {
        result.current.setWidth(2048);
      });

      expect(result.current.parameters).toMatchObject({
        width: 2048,
        height: 1024, // Clamped to max
      });
    });

    it('should update height with proportional width adjustment when locked', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: true,
        activeAspectRatio: '2:1',
      });

      act(() => {
        result.current.setHeight(512);
      });

      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 512,
      });
    });

    it('should toggle aspect ratio lock state', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isAspectRatioLocked: false });

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(true);

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(false);
    });

    it('should adjust dimensions when locking with mismatched ratio', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters({ width: 1024, height: 512 }), // 2:1 ratio
        parametersSchema: createTestSchema(),
        isAspectRatioLocked: false,
        activeAspectRatio: '1:1', // Target 1:1 ratio
      });

      act(() => {
        result.current.toggleAspectRatioLock();
      });

      expect(result.current.isAspectRatioLocked).toBe(true);
      expect(result.current.parameters).toMatchObject({
        width: 1024,
        height: 1024,
      });
    });
  });

  describe('Aspect Ratio Setting', () => {
    it('should update active aspect ratio', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      expect(result.current.activeAspectRatio).toBe('16:9');
    });

    it('should calculate dimensions for width/height-based models', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: createTestParameters(),
        parametersSchema: createTestSchema(),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      const params = result.current.parameters!;
      expect(params.width).toBeGreaterThan(params.height!);

      const ratio = params.width! / params.height!;
      expect(ratio).toBeCloseTo(16 / 9, 1);
    });

    it('should update aspectRatio parameter for models with native support', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: { aspectRatio: '1:1', prompt: '' },
        parametersSchema: createTestSchema({
          aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
        }),
      });

      act(() => {
        result.current.setAspectRatio('16:9');
      });

      expect(result.current.parameters?.aspectRatio).toBe('16:9');
      expect(result.current.activeAspectRatio).toBe('16:9');
    });

    it('should handle missing parameters or schema gracefully', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        parameters: undefined,
        parametersSchema: undefined,
      });

      expect(() => {
        act(() => {
          result.current.setAspectRatio('16:9');
        });
      }).not.toThrow();
    });
  });

  describe('Configuration Initialization', () => {
    beforeEach(() => {
      vi.doMock('@/store/global', () => ({
        useGlobalStore: {
          getState: () => ({
            status: {
              lastSelectedImageModel: 'flux/schnell',
              lastSelectedImageProvider: 'fal',
            },
          }),
        },
      }));

      vi.doMock('@/store/user', () => ({
        useUserStore: {
          getState: () => ({ user: { id: 'test' } }),
        },
      }));
    });

    it('should initialize with remembered model when user is logged in', () => {
      currentImageSettingsMock.mockReturnValueOnce({ defaultImageNum: 6 });
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({
        isInit: false,
        model: '',
        provider: '',
      });

      act(() => {
        result.current.initializeImageConfig(true, 'flux/schnell', 'fal');
      });

      expect(result.current.model).toBe('flux/schnell');
      expect(result.current.provider).toBe('fal');
      expect(result.current.parameters).toEqual(fluxSchnellDefaultValues);
      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(6);
    });

    it('should handle initialization without remembered preferences', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig(false);
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(4);
    });

    it('should handle initialization errors gracefully', () => {
      const { result } = renderHook(() => useImageStore());

      useImageStore.setState({ isInit: false });

      act(() => {
        result.current.initializeImageConfig(true, 'invalid-model', 'invalid-provider');
      });

      expect(result.current.isInit).toBe(true);
      expect(result.current.imageNum).toBe(4);
    });
  });
});
