// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_CUSTOM_SD,
  TEST_SD35_MODELS,
  TEST_SDXL_MODELS,
} from '@/server/services/comfyui/__tests__/fixtures/testModels';
import { mockContext } from '@/server/services/comfyui/__tests__/helpers/mockContext';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
import { buildSimpleSDWorkflow } from '@/server/services/comfyui/workflows/simple-sd';

// Setup basic mocks
vi.mock('@lobechat/utils', () => ({
  generateUniqueSeeds: vi.fn(() => ({ seed: 123456, noiseSeed: 654321 })),
}));
vi.mock('../utils/workflowUtils', () => ({
  getWorkflowFilenamePrefix: vi.fn(() => 'simple-sd'),
}));
vi.mock('../utils/staticModelLookup', () => ({
  getModelConfig: vi.fn((modelName: string) => {
    // Mock model configuration mapping
    if (modelName.includes('sd3.5') || modelName.includes('sd35')) {
      return {
        modelFamily: 'SD3',
        variant: 'medium',
      };
    }
    if (modelName.includes('sdxl') || modelName.includes('xl')) {
      return {
        modelFamily: 'SDXL',
        variant: 'base',
      };
    }
    if (modelName.includes('sd1') || modelName.includes('v1')) {
      return {
        modelFamily: 'SD1',
        variant: '5',
      };
    }
    if (modelName === TEST_CUSTOM_SD) {
      return {
        modelFamily: 'SD1',
        variant: 'custom',
      };
    }
    return null;
  }),
}));

const { inputCalls } = setupAllMocks();

// Extended mock context for SD testing
const createSDMockContext = () => ({
  ...mockContext,
  modelResolverService: {
    ...mockContext.modelResolverService,
    getAvailableVAEFiles: vi
      .fn()
      .mockResolvedValue([
        'vae-ft-mse-840000-ema-pruned.safetensors',
        'sdxl_vae_fp16fix.safetensors',
        'custom_sd_lobe_vae.safetensors',
      ]),
    getOptimalComponent: vi.fn().mockImplementation((type: string, modelFamily: string) => {
      if (type === 'vae') {
        if (modelFamily === 'SDXL') {
          return Promise.resolve('sdxl_vae_fp16fix.safetensors');
        }
        if (modelFamily === 'SD1') {
          return Promise.resolve('vae-ft-mse-840000-ema-pruned.safetensors');
        }
        // SD3 models have built-in VAE
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    }),
  },
});

describe('buildSimpleSDWorkflow - Universal SD Support', () => {
  let sdMockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    sdMockContext = createSDMockContext();
  });

  describe('Model Family Detection Tests', () => {
    it('should detect SD3.5 model family', async () => {
      const modelName = TEST_SD35_MODELS.MEDIUM;
      const params = {
        cfg: 4,
        height: 1024,
        prompt: 'SD3.5 family test',
        steps: 28,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // SD3 models shouldn't need external VAE
    });

    it('should detect SDXL model family', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'SDXL family test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // SDXL models should use external VAE
      expect(sdMockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        'vae',
        'SDXL',
      );
    });

    it('should handle custom SD model', async () => {
      const modelName = TEST_CUSTOM_SD;
      const params = {
        cfg: 7.5,
        height: 512,
        prompt: 'Custom SD model test',
        steps: 20,
        width: 512,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Custom models should check for custom VAE
      expect(sdMockContext.modelResolverService.getAvailableVAEFiles).toHaveBeenCalled();
    });
  });

  describe('Smart VAE Selection Tests', () => {
    it('should not attach VAE for SD3 models (built-in VAE)', async () => {
      const modelName = TEST_SD35_MODELS.LARGE;
      const params = {
        cfg: 4,
        height: 1024,
        prompt: 'SD3 built-in VAE test',
        steps: 28,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // SD3 should not request external VAE
    });

    it('should attach optimal VAE for SDXL models', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'SDXL VAE selection test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      expect(sdMockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        'vae',
        'SDXL',
      );
    });

    it('should handle custom VAE for custom models', async () => {
      const modelName = TEST_CUSTOM_SD;
      const params = {
        cfg: 7.5,
        height: 512,
        prompt: 'Custom VAE test',
        steps: 20,
        width: 512,
      };

      // Mock custom VAE availability
      sdMockContext.modelResolverService.getAvailableVAEFiles.mockResolvedValue([
        'custom_sd_lobe_vae.safetensors',
        'vae-ft-mse-840000-ema-pruned.safetensors',
      ]);

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      expect(sdMockContext.modelResolverService.getAvailableVAEFiles).toHaveBeenCalled();
    });

    it('should fallback to built-in VAE when custom VAE unavailable', async () => {
      const modelName = TEST_CUSTOM_SD;
      const params = {
        cfg: 7.5,
        height: 512,
        prompt: 'VAE fallback test',
        steps: 20,
        width: 512,
      };

      // Mock custom VAE not available
      sdMockContext.modelResolverService.getAvailableVAEFiles.mockResolvedValue([
        'vae-ft-mse-840000-ema-pruned.safetensors',
      ]);

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should fall back to built-in VAE
    });
  });

  describe('Dual Mode Support Tests', () => {
    it('should build text-to-image workflow', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'Text to image test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should be in t2i mode (no input image)
    });

    it('should build image-to-image workflow', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        denoise: 0.75,
        height: 1024,
        imageUrl: 'https://example.com/input.jpg',
        prompt: 'Image to image test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should be in i2i mode with input image
    });

    it('should handle strength parameter mapping to denoise', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        height: 1024,
        imageUrl: 'https://example.com/input.jpg',
        prompt: 'Strength mapping test',
        steps: 20,
        strength: 0.8, // Frontend parameter
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Strength should be mapped to denoise internally
    });

    it('should handle imageUrls array parameter', async () => {
      const modelName = TEST_SDXL_MODELS.BASE;
      const params = {
        cfg: 7.5,
        height: 1024,
        imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        prompt: 'Multiple images test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should use first image from array
    });
  });

  describe('Parameter Validation Tests', () => {
    it('should handle different CFG values by model family', async () => {
      const testCases = [
        { model: TEST_SD35_MODELS.MEDIUM, cfg: 4, family: 'SD3' },
        { model: TEST_SDXL_MODELS.BASE, cfg: 7.5, family: 'SDXL' },
        { model: TEST_CUSTOM_SD, cfg: 7.5, family: 'SD1' },
      ];

      for (const testCase of testCases) {
        const params = {
          cfg: testCase.cfg,
          height: 1024,
          prompt: `CFG test for ${testCase.family}`,
          steps: 20,
          width: 1024,
        };

        const result = await buildSimpleSDWorkflow(testCase.model, params, sdMockContext);
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });

    it('should handle different schedulers by model family', async () => {
      const testCases = [
        { model: TEST_SD35_MODELS.MEDIUM, scheduler: 'sgm_uniform' },
        { model: TEST_SDXL_MODELS.BASE, scheduler: 'normal' },
        { model: TEST_CUSTOM_SD, scheduler: 'normal' },
      ];

      for (const testCase of testCases) {
        const params = {
          cfg: 7.5,
          height: 1024,
          prompt: `Scheduler test: ${testCase.scheduler}`,
          scheduler: testCase.scheduler,
          steps: 20,
          width: 1024,
        };

        const result = await buildSimpleSDWorkflow(testCase.model, params, sdMockContext);
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });

    it('should handle various image dimensions', async () => {
      const dimensions = [
        { width: 512, height: 512 }, // SD1.5 default
        { width: 1024, height: 1024 }, // SDXL default
        { width: 768, height: 1024 }, // Portrait
        { width: 1344, height: 768 }, // Landscape
      ];

      for (const dim of dimensions) {
        const params = {
          cfg: 7.5,
          height: dim.height,
          prompt: `Dimension test ${dim.width}x${dim.height}`,
          steps: 20,
          width: dim.width,
        };

        const result = await buildSimpleSDWorkflow(TEST_SDXL_MODELS.BASE, params, sdMockContext);
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle unknown model gracefully', async () => {
      const modelName = 'unknown-model.safetensors';
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'Unknown model test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(modelName, params, sdMockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should work with default configuration
    });

    it('should handle VAE resolution failure', async () => {
      const failingContext = {
        ...sdMockContext,
        modelResolverService: {
          ...sdMockContext.modelResolverService,
          getOptimalComponent: vi.fn().mockRejectedValue(new Error('VAE not found')),
        },
      };

      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'VAE failure test',
        steps: 20,
        width: 1024,
      };

      // Should not throw for SD3 models (built-in VAE)
      const result = await buildSimpleSDWorkflow(TEST_SD35_MODELS.MEDIUM, params, failingContext);
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });

    it('should handle empty prompt', async () => {
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: '',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(TEST_SDXL_MODELS.BASE, params, sdMockContext);
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });
  });

  describe('Advanced Features Tests', () => {
    it('should support negative prompts', async () => {
      const params = {
        cfg: 7.5,
        height: 1024,
        negativePrompt: 'low quality, blurry',
        prompt: 'High quality image',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(TEST_SDXL_MODELS.BASE, params, sdMockContext);
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });

    it('should handle seed generation', async () => {
      const { generateUniqueSeeds } = await import('@lobechat/utils');
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'Seed test',
        steps: 20,
        width: 1024,
      };

      await buildSimpleSDWorkflow(TEST_SDXL_MODELS.BASE, params, sdMockContext);

      expect(generateUniqueSeeds).toHaveBeenCalled();
    });

    it('should support custom sampler settings', async () => {
      const params = {
        cfg: 7.5,
        height: 1024,
        prompt: 'Custom sampler test',
        samplerName: 'dpmpp_2m_sde',
        scheduler: 'karras',
        steps: 25,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(TEST_SDXL_MODELS.BASE, params, sdMockContext);
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });
  });

  describe('Backward Compatibility Tests', () => {
    it('should maintain API compatibility with existing calls', async () => {
      // Test with minimal parameters (existing API pattern)
      const minimalParams = {
        prompt: 'Backward compatibility test',
      };

      const result = await buildSimpleSDWorkflow(
        TEST_SDXL_MODELS.BASE,
        minimalParams,
        sdMockContext,
      );
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });

    it('should handle legacy parameter names', async () => {
      const legacyParams = {
        cfg: 7.5,
        height: 1024,
        inputImage: 'https://example.com/legacy.jpg', // Legacy parameter
        prompt: 'Legacy parameter test',
        steps: 20,
        width: 1024,
      };

      const result = await buildSimpleSDWorkflow(
        TEST_SDXL_MODELS.BASE,
        legacyParams,
        sdMockContext,
      );
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });
  });
});
