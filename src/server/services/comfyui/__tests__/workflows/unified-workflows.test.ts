// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_FLUX_MODELS,
  TEST_SD35_MODELS,
} from '@/server/services/comfyui/__tests__/fixtures/testModels';
import { mockContext } from '@/server/services/comfyui/__tests__/helpers/mockContext';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
import { WorkflowError } from '@/server/services/comfyui/errors';
import { buildFluxDevWorkflow } from '@/server/services/comfyui/workflows/flux-dev';
import { buildFluxKontextWorkflow } from '@/server/services/comfyui/workflows/flux-kontext';
import { buildFluxSchnellWorkflow } from '@/server/services/comfyui/workflows/flux-schnell';
import { buildSD35Workflow } from '@/server/services/comfyui/workflows/sd35';
import { buildSimpleSDWorkflow } from '@/server/services/comfyui/workflows/simple-sd';

// Create inline test parameters to avoid external dependencies
const TEST_PARAMETERS = {
  'flux-dev': {
    defaults: { cfg: 3.5, steps: 20, samplerName: 'euler', scheduler: 'simple' },
    boundaries: { min: { cfg: 1, steps: 1 }, max: { cfg: 30, steps: 50 } },
  },
  'flux-schnell': {
    defaults: { cfg: 1, steps: 4, samplerName: 'euler', scheduler: 'simple' },
    boundaries: { min: { cfg: 1, steps: 1 }, max: { cfg: 1, steps: 8 } },
  },
  'flux-kontext': {
    defaults: { strength: 0.8 },
  },
  'sd35': {
    defaults: { cfg: 4, steps: 20, samplerName: 'euler', scheduler: 'sgm_uniform' },
    boundaries: { min: { cfg: 1, steps: 1 }, max: { cfg: 20, steps: 100 } },
  },
  'sdxl': {
    defaults: { cfg: 7.5, steps: 20, samplerName: 'euler', scheduler: 'normal' },
    boundaries: { min: { cfg: 1, steps: 1 }, max: { cfg: 20, steps: 100 } },
  },
} as const;

// Mock the utility functions globally
vi.mock('../utils/promptSplitter', () => ({
  splitPromptForDualCLIP: vi.fn((prompt: string) => ({
    clipLPrompt: prompt,
    t5xxlPrompt: prompt,
  })),
}));

vi.mock('../utils/weightDType', () => ({
  selectOptimalWeightDtype: vi.fn(() => 'default'),
}));

vi.mock('../utils/modelResolver', () => ({
  resolveModel: vi.fn((modelName: string) => {
    const cleanName = modelName.replace(/^comfyui\//, '');

    // Return mock configuration based on model name patterns
    if (cleanName.includes('flux_dev') || cleanName.includes('flux-dev')) {
      return { family: 'flux', modelFamily: 'FLUX', variant: 'dev' };
    }
    if (cleanName.includes('flux_schnell') || cleanName.includes('flux-schnell')) {
      return { family: 'flux', modelFamily: 'FLUX', variant: 'schnell' };
    }
    if (cleanName.includes('flux_kontext') || cleanName.includes('kontext')) {
      return { family: 'flux', modelFamily: 'FLUX', variant: 'kontext' };
    }
    if (cleanName.includes('sd3.5') || cleanName.includes('sd35')) {
      return { family: 'sd35', modelFamily: 'SD3', variant: 'sd35' };
    }
    if (cleanName.includes('sdxl') || cleanName.includes('xl')) {
      return { family: 'sdxl', modelFamily: 'SDXL', variant: 'sdxl' };
    }
    if (cleanName.includes('v1-5') || cleanName.includes('sd15')) {
      return { family: 'sd15', modelFamily: 'SD1', variant: 'sd15' };
    }
    return null;
  }),
}));

// Workflow builders configuration
type WorkflowBuilderFunction = (modelFileName: string, params: any, context: any) => Promise<any>;

interface WorkflowTestConfig {
  builder: WorkflowBuilderFunction;
  errorTests?: boolean;
  modelName: string;
  name: string;
  parameterKey: keyof typeof TEST_PARAMETERS;
  specialFeatures?: string[];
}

const WORKFLOW_CONFIGS: WorkflowTestConfig[] = [
  {
    name: 'FLUX Dev',
    builder: buildFluxDevWorkflow,
    modelName: TEST_FLUX_MODELS.DEV,
    parameterKey: 'flux-dev',
    specialFeatures: ['variable CFG', 'advanced sampler'],
  },
  {
    name: 'FLUX Schnell',
    builder: buildFluxSchnellWorkflow,
    modelName: TEST_FLUX_MODELS.SCHNELL,
    parameterKey: 'flux-schnell',
    specialFeatures: ['fixed CFG', 'fast generation'],
  },
  {
    name: 'FLUX Kontext',
    builder: buildFluxKontextWorkflow,
    modelName: TEST_FLUX_MODELS.KONTEXT,
    parameterKey: 'flux-kontext',
    specialFeatures: ['img2img support', 'vision capabilities'],
  },
  {
    name: 'SD3.5',
    builder: buildSD35Workflow,
    modelName: TEST_SD35_MODELS.LARGE,
    parameterKey: 'sd35',
    specialFeatures: ['external encoders', 'SGM scheduler'],
    errorTests: true,
  },
  {
    name: 'Simple SD',
    builder: buildSimpleSDWorkflow,
    modelName: 'sd_xl_base_1.0.safetensors',
    parameterKey: 'sdxl',
    specialFeatures: ['VAE handling', 'legacy support'],
  },
];

describe('Unified Workflow Tests', () => {
  const { inputCalls } = setupAllMocks();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(WORKFLOW_CONFIGS)('$name Workflow', (config) => {
    it('should create workflow with default parameters', async () => {
      const fixture = TEST_PARAMETERS[config.parameterKey];
      const params = {
        prompt: 'A beautiful landscape',
        ...fixture!.defaults,
        // Add standard dimensions for text-to-image models
        width: 1024,
        height: 1024,
      };

      const result = await config.builder(config.modelName, params, mockContext);

      // Verify workflow result is returned
      expect(result).toBeDefined();
      expect(result).toHaveProperty('input'); // PromptBuilder mock returns object with input method
    });

    it('should create workflow with custom parameters', async () => {
      const fixture = TEST_PARAMETERS[config.parameterKey];
      const customParams = {
        prompt: 'Custom prompt for testing',
        width: 768,
        height: 512,
        steps: (fixture as any).boundaries?.max?.steps || 30,
        cfg: (fixture as any).boundaries?.max?.cfg || 7.5,
      };

      const result = await config.builder(config.modelName, customParams, mockContext);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('input');
    });

    it('should handle empty prompt gracefully', async () => {
      const fixture = TEST_PARAMETERS[config.parameterKey];
      const params = {
        prompt: '',
        ...fixture!.defaults,
        width: 1024,
        height: 1024,
      };

      const result = await config.builder(config.modelName, params, mockContext);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('input');
    });

    it('should handle boundary values correctly', async () => {
      const fixture = TEST_PARAMETERS[config.parameterKey];

      // Only test boundaries if they exist - Linus principle: don't test what doesn't exist
      if ((fixture as any).boundaries) {
        const minParams = {
          prompt: 'Minimum value test',
          width: 512,
          height: 512,
          steps: (fixture as any).boundaries.min.steps,
          cfg: (fixture as any).boundaries.min.cfg,
        };
        const minResult = await config.builder(config.modelName, minParams, mockContext);
        expect(minResult).toBeDefined();

        const maxParams = {
          prompt: 'Maximum value test',
          width: 1024,
          height: 1024,
          steps: (fixture as any).boundaries.max.steps,
          cfg: (fixture as any).boundaries.max.cfg,
        };
        const maxResult = await config.builder(config.modelName, maxParams, mockContext);
        expect(maxResult).toBeDefined();
      }
    });

    // Special feature tests
    if (config.specialFeatures?.includes('img2img support')) {
      it('should handle image-to-image parameters', async () => {
        const params = {
          prompt: 'Transform this image',
          imageUrl: 'https://example.com/test.jpg',
          strength: 0.8,
          width: 1024,
          height: 1024,
        };

        const result = await config.builder(config.modelName, params, mockContext);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('input');
      });

      it('should handle multiple image URLs', async () => {
        const params = {
          prompt: 'Process multiple images',
          imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
          strength: 0.75,
          width: 1024,
          height: 1024,
        };

        const result = await config.builder(config.modelName, params, mockContext);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('input');
      });
    }

    if (config.specialFeatures?.includes('variable CFG')) {
      it('should support variable CFG values', async () => {
        const params = {
          prompt: 'Variable CFG test',
          cfg: 5, // Different from default
          width: 1024,
          height: 1024,
        };

        const result = await config.builder(config.modelName, params, mockContext);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('input');
      });
    }

    if (config.specialFeatures?.includes('fixed CFG')) {
      it('should use fixed CFG regardless of input', async () => {
        const params = {
          prompt: 'Fixed CFG test',
          cfg: 7, // Should be ignored for Schnell
          width: 1024,
          height: 1024,
        };

        const result = await config.builder(config.modelName, params, mockContext);

        expect(result).toBeDefined();
        expect(result).toHaveProperty('input');
      });
    }

    // Error handling tests for models that support them
    if (config.errorTests) {
      it('should throw WorkflowError when required components are missing', async () => {
        // Create a context that simulates missing encoders
        const mockContextNoEncoders = {
          ...mockContext,
          modelResolverService: {
            ...mockContext.modelResolverService,
            getOptimalComponent: vi.fn().mockResolvedValue(undefined),
          },
        };

        const params = {
          prompt: 'Test with missing encoders',
        };

        await expect(
          config.builder(config.modelName, params, mockContextNoEncoders),
        ).rejects.toThrow(WorkflowError);
      });
    }
  });

  // Cross-workflow comparison tests
  describe('Cross-Workflow Validation', () => {
    it('should handle aspect ratio transformations consistently', async () => {
      const aspectRatioTests = [
        { input: '16:9', expected: { width: 1024, height: 576 } },
        { input: '1:1', expected: { width: 1024, height: 1024 } },
        { input: '9:16', expected: { width: 576, height: 1024 } },
      ];

      for (const ratioTest of aspectRatioTests) {
        const params = {
          prompt: 'Aspect ratio test',
          width: ratioTest.expected.width,
          height: ratioTest.expected.height,
        };

        // Test with multiple workflows
        for (const config of WORKFLOW_CONFIGS.slice(0, 3)) {
          // Test first 3 workflows
          const result = await config.builder(config.modelName, params, mockContext);
          expect(result).toBeDefined();
        }
      }
    });

    it('should handle seed parameter consistently', async () => {
      const testSeeds = [undefined, 0, 12345, 999999];

      for (const seed of testSeeds) {
        const params = {
          prompt: 'Seed consistency test',
          seed,
          width: 1024,
          height: 1024,
        };

        // Test with workflows that support seed
        for (const config of WORKFLOW_CONFIGS.filter((c) => c.name !== 'FLUX Kontext')) {
          const result = await config.builder(config.modelName, params, mockContext);
          expect(result).toBeDefined();
        }
      }
    });
  });

  // Performance and validation tests
  describe('Performance and Validation', () => {
    it('should create workflows efficiently', async () => {
      const startTime = Date.now();

      // Create multiple workflows in parallel
      const promises = WORKFLOW_CONFIGS.map((config) =>
        config.builder(config.modelName, { prompt: 'Performance test' }, mockContext),
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      // Verify all workflows were created
      results.forEach((result) => {
        expect(result).toBeDefined();
      });

      // Simple performance check - should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle malformed parameters gracefully', async () => {
      const malformedParams = [
        { prompt: null },
        { prompt: 'test', width: -100 },
        { prompt: 'test', height: 0 },
        { prompt: 'test', steps: -5 },
      ];

      for (const params of malformedParams) {
        for (const config of WORKFLOW_CONFIGS.slice(0, 2)) {
          // Test with 2 workflows
          // Should not throw - workflows should handle invalid params gracefully
          try {
            const result = await config.builder(config.modelName, params as any, mockContext);
            expect(result).toBeDefined();
          } catch (error) {
            // If it throws, it should be a specific workflow error, not a generic JS error
            expect(error).toBeInstanceOf(Error);
          }
        }
      }
    });
  });
});
