import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelConfig } from '@/server/services/comfyui/config/modelRegistry';
import { resolveModel } from '@/server/services/comfyui/utils/staticModelLookup';
import {
  type SD3Variant,
  WorkflowDetector,
} from '@/server/services/comfyui/utils/workflowDetector';

// Mock static model lookup functions
vi.mock('../../utils/staticModelLookup', () => ({
  resolveModel: vi.fn(),
  getModelConfig: vi.fn(),
}));

describe('WorkflowDetector', () => {
  const mockedResolveModel = resolveModel as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectModelType', () => {
    describe('Input Processing', () => {
      it('should remove "comfyui/" prefix from modelId', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('comfyui/flux-dev');

        expect(mockedResolveModel).toHaveBeenCalledWith('flux-dev');
        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });

      it('should handle modelId without comfyui prefix', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'schnell',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-schnell');

        expect(mockedResolveModel).toHaveBeenCalledWith('flux-schnell');
        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'schnell',
        });
      });

      it('should handle multiple comfyui prefixes correctly', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD3',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'sd35',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        // Only the first "comfyui/" should be removed
        const result = WorkflowDetector.detectModelType('comfyui/comfyui/model');

        expect(mockedResolveModel).toHaveBeenCalledWith('comfyui/model');
        expect(result).toEqual({
          architecture: 'SD3',
          isSupported: true,
          variant: 'sd35',
        });
      });
    });

    describe('FLUX Model Detection', () => {
      it('should detect FLUX dev variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-dev');

        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });

      it('should detect FLUX schnell variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 2,
          recommendedDtype: 'fp8_e4m3fn',
          variant: 'schnell',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-schnell-fp8');

        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'schnell',
        });
      });

      it('should detect FLUX kontext variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'kontext',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-kontext-dev');

        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'kontext',
        });
      });

      it('should detect FLUX krea model with dev variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-krea-dev');

        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });

      it('should handle FLUX model with comfyui prefix', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 2,
          recommendedDtype: 'fp8_e5m2',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('comfyui/custom-flux-model');

        expect(mockedResolveModel).toHaveBeenCalledWith('custom-flux-model');
        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });
    });

    describe('Custom SD Model Detection', () => {
      it('should detect custom SD model', () => {
        const result = WorkflowDetector.detectModelType('stable-diffusion-custom');

        // Custom SD models are hardcoded and don't use resolveModel
        expect(mockedResolveModel).not.toHaveBeenCalled();
        expect(result).toEqual({
          architecture: 'SDXL', // Uses SDXL for img2img support
          isSupported: true,
          variant: 'custom-sd',
        });
      });

      it('should detect custom SD refiner model', () => {
        const result = WorkflowDetector.detectModelType('stable-diffusion-custom-refiner');

        // Custom SD models are hardcoded and don't use resolveModel
        expect(mockedResolveModel).not.toHaveBeenCalled();
        expect(result).toEqual({
          architecture: 'SDXL', // Uses SDXL for img2img support
          isSupported: true,
          variant: 'custom-sd',
        });
      });

      it('should handle custom SD with comfyui prefix', () => {
        const result = WorkflowDetector.detectModelType('comfyui/stable-diffusion-custom');

        // Custom SD models are hardcoded and don't use resolveModel
        expect(mockedResolveModel).not.toHaveBeenCalled();
        expect(result).toEqual({
          architecture: 'SDXL', // Uses SDXL for img2img support
          isSupported: true,
          variant: 'custom-sd',
        });
      });
    });

    describe('SD3 Model Detection', () => {
      it('should detect SD3 sd35 variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD3',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'sd35',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('sd3.5_large');

        expect(result).toEqual({
          architecture: 'SD3',
          isSupported: true,
          variant: 'sd35',
        });
      });

      it('should handle SD3 model with comfyui prefix', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD3',
          priority: 2,
          recommendedDtype: 'default',
          variant: 'sd35',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('comfyui/sd3.5_medium');

        expect(mockedResolveModel).toHaveBeenCalledWith('sd3.5_medium');
        expect(result).toEqual({
          architecture: 'SD3',
          isSupported: true,
          variant: 'sd35',
        });
      });
    });

    describe('Unknown/Unsupported Model Detection', () => {
      it('should return unknown architecture when model is not found', () => {
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType('unknown-model');

        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });

      it('should return SDXL architecture for SDXL model family', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SDXL' as any,
          priority: 1,
          recommendedDtype: 'default',
          variant: 'sdxl-t2i',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('sdxl-base');

        expect(result).toEqual({
          architecture: 'SDXL',
          isSupported: true,
          variant: 'sdxl-t2i',
        });
      });

      it('should return SD1 architecture for SD1 model family', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD1' as any,
          priority: 3,
          recommendedDtype: 'default',
          variant: 'sd15-t2i',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('stable-diffusion-v1-5');

        expect(result).toEqual({
          architecture: 'SD1',
          isSupported: true,
          variant: 'sd15-t2i',
        });
      });

      it('should handle null modelId by causing runtime error (expected behavior)', () => {
        // According to the function signature, modelId is expected to be a string
        // Passing null/undefined would cause a runtime error, which is expected behavior
        expect(() => {
          WorkflowDetector.detectModelType(null as any);
        }).toThrow('Cannot read properties of null');
      });

      it('should handle undefined modelId by causing runtime error (expected behavior)', () => {
        // According to the function signature, modelId is expected to be a string
        // Passing null/undefined would cause a runtime error, which is expected behavior
        expect(() => {
          WorkflowDetector.detectModelType(undefined as any);
        }).toThrow('Cannot read properties of undefined');
      });

      it('should handle empty string modelId', () => {
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType('');

        expect(mockedResolveModel).toHaveBeenCalledWith('');
        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });

      it('should handle whitespace-only modelId', () => {
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType('   ');

        expect(mockedResolveModel).toHaveBeenCalledWith('   ');
        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });
    });

    describe('Type Casting', () => {
      it('should properly cast FLUX variant to FluxVariant type', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('flux-model');

        expect(result.variant).toBe('dev');
        expect(typeof result.variant).toBe('string');

        // Test with dev variant (krea uses dev workflow)
        const mockKreaConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockKreaConfig);

        const kreaResult = WorkflowDetector.detectModelType('flux-krea-model');
        expect(kreaResult.variant).toBe('dev');
      });

      it('should properly cast SD3 variant to SD3Variant type', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD3',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'sd35',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('sd3-model');

        expect(result.variant).toBe('sd35');
        expect(typeof result.variant).toBe('string');

        // Verify it matches SD3Variant type expectations
        const sd3Variants: SD3Variant[] = ['sd35'];
        expect(sd3Variants).toContain(result.variant as SD3Variant);
      });
    });

    describe('Edge Cases', () => {
      it('should handle special characters in modelId', () => {
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType('model-with-special!@#$%^&*()_+');

        expect(mockedResolveModel).toHaveBeenCalledWith('model-with-special!@#$%^&*()_+');
        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });

      it('should handle modelId with path separators', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('path/to/model.safetensors');

        expect(mockedResolveModel).toHaveBeenCalledWith('path/to/model.safetensors');
        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });

      it('should handle very long modelId', () => {
        const longModelId = 'a'.repeat(1000);
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType(longModelId);

        expect(mockedResolveModel).toHaveBeenCalledWith(longModelId);
        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });

      it('should handle modelId that is only "comfyui/"', () => {
        mockedResolveModel.mockReturnValue(null);

        const result = WorkflowDetector.detectModelType('comfyui/');

        expect(mockedResolveModel).toHaveBeenCalledWith('');
        expect(result).toEqual({
          architecture: 'unknown',
          isSupported: false,
        });
      });

      it('should handle case sensitivity in modelId', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          variant: 'dev',
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('COMFYUI/FLUX-DEV');

        // Should not match the prefix replacement since it's case sensitive
        expect(mockedResolveModel).toHaveBeenCalledWith('COMFYUI/FLUX-DEV');
        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: 'dev',
        });
      });
    });

    describe('Configuration Edge Cases', () => {
      it('should handle config with missing variant property', () => {
        const mockConfig: Partial<ModelConfig> = {
          modelFamily: 'FLUX',
          priority: 1,
          recommendedDtype: 'default',
          // variant is missing
        };
        mockedResolveModel.mockReturnValue(mockConfig as ModelConfig);

        const result = WorkflowDetector.detectModelType('flux-model');

        expect(result).toEqual({
          architecture: 'FLUX',
          isSupported: true,
          variant: undefined, // Will be cast to FluxVariant but is undefined
        });
      });

      it('should handle config with null variant', () => {
        const mockConfig: ModelConfig = {
          modelFamily: 'SD3',
          priority: 1,
          recommendedDtype: 'default',
          variant: null as any,
        };
        mockedResolveModel.mockReturnValue(mockConfig);

        const result = WorkflowDetector.detectModelType('sd3-model');

        expect(result).toEqual({
          architecture: 'SD3',
          isSupported: true,
          variant: null, // Will be cast to SD3Variant but is null
        });
      });
    });
  });
});
