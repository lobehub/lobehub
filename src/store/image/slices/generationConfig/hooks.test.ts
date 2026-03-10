import { act, renderHook } from '@testing-library/react';
import {
  type AIImageModelCard,
  type ModelParamsSchema,
  type RuntimeImageGenParams,
} from 'model-bank';
import { fluxSchnellParamsSchema } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { useImageStore } from '@/store/image';

import { useGenerationConfigParam } from './hooks';

// Mock external dependencies
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: vi.fn(() => [
      {
        id: 'fal',
        name: 'Fal',
        children: [
          {
            id: 'flux/schnell',
            displayName: 'FLUX.1 Schnell',
            type: 'image',
            parameters: fluxSchnellParamsSchema,
            releasedAt: '2024-08-01',
          } as AIImageModelCard,
        ],
      },
    ]),
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

const testModelSchema: ModelParamsSchema = {
  prompt: { default: '', description: 'The text prompt for image generation' },
  width: { default: 1024, min: 512, max: 2048, step: 64, description: 'Image width' },
  height: { default: 768, min: 256, max: 1536, step: 32, description: 'Image height' },
  steps: { default: 20, min: 1, max: 50, description: 'Number of inference steps' },
  seed: { default: null, min: 0, max: 2147483647, description: 'Random seed' },
  cfg: { default: 7.5, min: 1, max: 20, step: 0.5, description: 'CFG scale' },
  aspectRatio: {
    default: '16:9',
    enum: ['1:1', '16:9', '4:3', '9:16'],
    description: 'Aspect ratio',
  },
};

const testParameters: RuntimeImageGenParams = {
  prompt: 'test prompt',
  width: 1024,
  height: 768,
  steps: 25,
  seed: 12345,
  cfg: 8,
  aspectRatio: '16:9',
};

describe('useGenerationConfigParam', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store state before each test
    useImageStore.setState({
      parametersSchema: testModelSchema,
      parameters: testParameters,
    });
  });

  describe('value and setValue', () => {
    it('should return current parameter value', () => {
      const { result } = renderHook(() => useGenerationConfigParam('width'));
      expect(result.current.value).toBe(1024);
    });

    it('should return current string parameter value', () => {
      const { result } = renderHook(() => useGenerationConfigParam('prompt'));
      expect(result.current.value).toBe('test prompt');
    });

    it('should return null for null values', () => {
      useImageStore.setState({
        parameters: { ...testParameters, seed: null },
      });

      const { result } = renderHook(() => useGenerationConfigParam('seed'));
      expect(result.current.value).toBeNull();
    });

    it('should update parameter value using setValue', () => {
      const { result } = renderHook(() => useGenerationConfigParam('width'));

      act(() => {
        result.current.setValue(2048);
      });

      const updatedParameters = useImageStore.getState().parameters;
      expect(updatedParameters?.width).toBe(2048);
    });

    it('should update string parameter value using setValue', () => {
      const { result } = renderHook(() => useGenerationConfigParam('prompt'));

      act(() => {
        result.current.setValue('new test prompt');
      });

      const updatedParameters = useImageStore.getState().parameters;
      expect(updatedParameters?.prompt).toBe('new test prompt');
    });

    it('should handle array parameter updates', () => {
      const { result } = renderHook(() => useGenerationConfigParam('imageUrls'));

      act(() => {
        result.current.setValue(['image1.jpg', 'image2.jpg']);
      });

      const updatedParameters = useImageStore.getState().parameters;
      expect(updatedParameters?.imageUrls).toEqual(['image1.jpg', 'image2.jpg']);
    });
  });

  describe('parameter constraints', () => {
    it('should return min and max constraints for numeric parameter', () => {
      const { result } = renderHook(() => useGenerationConfigParam('width'));

      expect(result.current.min).toBe(512);
      expect(result.current.max).toBe(2048);
      expect(result.current.step).toBe(64);
      expect(result.current.description).toBe('Image width');
      expect(result.current.enumValues).toBeUndefined();
    });

    it('should return step constraint for decimal parameter', () => {
      const { result } = renderHook(() => useGenerationConfigParam('cfg'));

      expect(result.current.min).toBe(1);
      expect(result.current.max).toBe(20);
      expect(result.current.step).toBe(0.5);
      expect(result.current.description).toBe('CFG scale');
    });

    it('should return enum values for enum parameter', () => {
      const { result } = renderHook(() => useGenerationConfigParam('aspectRatio'));

      expect(result.current.enumValues).toEqual(['1:1', '16:9', '4:3', '9:16']);
      expect(result.current.description).toBe('Aspect ratio');
      expect(result.current.min).toBeUndefined();
      expect(result.current.max).toBeUndefined();
      expect(result.current.step).toBeUndefined();
    });

    it('should return undefined constraints for parameter without constraints', () => {
      const { result } = renderHook(() => useGenerationConfigParam('prompt'));

      expect(result.current.min).toBeUndefined();
      expect(result.current.max).toBeUndefined();
      expect(result.current.step).toBeUndefined();
      expect(result.current.enumValues).toBeUndefined();
      expect(result.current.description).toBe('The text prompt for image generation');
    });

    it('should handle seed parameter with large range', () => {
      const { result } = renderHook(() => useGenerationConfigParam('seed'));

      expect(result.current.min).toBe(0);
      expect(result.current.max).toBe(2147483647);
      expect(result.current.step).toBeUndefined();
      expect(result.current.description).toBe('Random seed');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined parameters', () => {
      useImageStore.setState({ parameters: undefined });

      const { result } = renderHook(() => useGenerationConfigParam('width'));
      expect(result.current.value).toBeUndefined();
    });

    it('should handle undefined parametersSchema', () => {
      useImageStore.setState({ parametersSchema: undefined });

      const { result } = renderHook(() => useGenerationConfigParam('width'));

      expect(result.current.min).toBeUndefined();
      expect(result.current.max).toBeUndefined();
      expect(result.current.step).toBeUndefined();
      expect(result.current.description).toBeUndefined();
      expect(result.current.enumValues).toBeUndefined();
    });

    it('should handle parameter not in current parametersSchema', () => {
      useImageStore.setState({
        parametersSchema: { prompt: { default: '' } }, // Only prompt defined
      });

      const { result } = renderHook(() => useGenerationConfigParam('width'));

      expect(result.current.min).toBeUndefined();
      expect(result.current.max).toBeUndefined();
      expect(result.current.step).toBeUndefined();
      expect(result.current.enumValues).toBeUndefined();
    });
  });

  describe('flux/schnell real-world parameters', () => {
    it('should work with actual flux/schnell parameters', () => {
      useImageStore.setState({
        parametersSchema: fluxSchnellParamsSchema,
        parameters: {
          prompt: 'A beautiful landscape',
          width: 1024,
          height: 1024,
          steps: 4,
          seed: null,
        },
      });

      // Test prompt parameter
      const { result: promptResult } = renderHook(() => useGenerationConfigParam('prompt'));
      expect(promptResult.current.value).toBe('A beautiful landscape');
      // flux-schnell's prompt parameter doesn't have description

      // Test width parameter
      const { result: widthResult } = renderHook(() => useGenerationConfigParam('width'));
      expect(widthResult.current.value).toBe(1024);
      expect(widthResult.current.min).toBeDefined();
      expect(widthResult.current.max).toBeDefined();

      // Test steps parameter
      const { result: stepsResult } = renderHook(() => useGenerationConfigParam('steps'));
      expect(stepsResult.current.value).toBe(4);
      expect(stepsResult.current.min).toBeDefined();
      expect(stepsResult.current.max).toBeDefined();

      // Test seed parameter
      const { result: seedResult } = renderHook(() => useGenerationConfigParam('seed'));
      expect(seedResult.current.value).toBeNull();
    });

    it('should update flux/schnell parameters correctly', () => {
      useImageStore.setState({
        parametersSchema: fluxSchnellParamsSchema,
        parameters: {
          prompt: 'original prompt',
          width: 512,
          height: 512,
          steps: 1,
          seed: null,
        },
      });

      const { result: promptResult } = renderHook(() => useGenerationConfigParam('prompt'));
      const { result: widthResult } = renderHook(() => useGenerationConfigParam('width'));

      // Update prompt
      act(() => {
        promptResult.current.setValue('updated prompt');
      });

      // Update width
      act(() => {
        widthResult.current.setValue(1024);
      });

      const updatedParameters = useImageStore.getState().parameters;
      expect(updatedParameters?.prompt).toBe('updated prompt');
      expect(updatedParameters?.width).toBe(1024);
    });
  });

  describe('setValue callback stability', () => {
    it('should maintain setValue callback reference when value changes', () => {
      const { result, rerender } = renderHook(() => useGenerationConfigParam('width'));

      const initialSetValue = result.current.setValue;

      // Change the parameter value
      act(() => {
        result.current.setValue(2048);
      });

      rerender();

      // setValue callback should remain the same reference
      expect(result.current.setValue).toBe(initialSetValue);
    });

    it('should maintain setValue callback reference when other parameters change', () => {
      const { result: widthResult } = renderHook(() => useGenerationConfigParam('width'));
      const { result: promptResult } = renderHook(() => useGenerationConfigParam('prompt'));

      const initialWidthSetValue = widthResult.current.setValue;

      // Change a different parameter
      act(() => {
        promptResult.current.setValue('new prompt');
      });

      // setValue callback for width should remain the same reference
      expect(widthResult.current.setValue).toBe(initialWidthSetValue);
    });
  });
});
