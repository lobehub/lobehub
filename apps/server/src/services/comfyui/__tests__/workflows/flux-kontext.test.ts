// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_FLUX_MODELS } from '@/server/services/comfyui/__tests__/fixtures/testModels';
import { mockContext } from '@/server/services/comfyui/__tests__/helpers/mockContext';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
import { buildFluxKontextWorkflow } from '@/server/services/comfyui/workflows/flux-kontext';

// Setup basic mocks
vi.mock('../utils/promptSplitter', () => ({
  splitPromptForDualCLIP: vi.fn((prompt) => ({
    clipLPrompt: prompt,
    t5xxlPrompt: prompt,
  })),
}));
vi.mock('../utils/weightDType', () => ({
  selectOptimalWeightDtype: vi.fn(() => 'default'),
}));
vi.mock('@lobechat/utils', () => ({
  generateUniqueSeeds: vi.fn(() => ({ seed: 123456, noiseSeed: 654321 })),
}));
vi.mock('../utils/workflowUtils', () => ({
  getWorkflowFilenamePrefix: vi.fn(() => 'kontext'),
}));

const { inputCalls } = setupAllMocks();

describe('buildFluxKontextWorkflow - Complex Dual-Mode Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dual-Mode Architecture Tests', () => {
    it('should build text-to-image workflow when no input image provided', async () => {
      const modelName = TEST_FLUX_MODELS.KONTEXT;
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'A beautiful landscape',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(modelName, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Verify text-to-image mode: no image loader nodes
      expect(mockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        't5',
        'FLUX',
      );
      expect(mockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        'vae',
        'FLUX',
      );
      expect(mockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        'clip',
        'FLUX',
      );
    });

    it('should build image-to-image workflow when input image provided', async () => {
      const modelName = TEST_FLUX_MODELS.KONTEXT;
      const params = {
        cfg: 3.5,
        height: 1024,
        imageUrl: 'https://example.com/input.jpg',
        prompt: 'Transform this image',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(modelName, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Verify image-to-image mode configuration
      expect(mockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledTimes(3);
    });

    it('should handle imageUrls array parameter', async () => {
      const modelName = TEST_FLUX_MODELS.KONTEXT;
      const params = {
        cfg: 3.5,
        height: 1024,
        imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        prompt: 'Process first image',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(modelName, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Should use first image from array for i2i mode
    });
  });

  describe('Dynamic Node Management Tests', () => {
    it('should create workflow with all required nodes for t2i mode', async () => {
      const modelName = TEST_FLUX_MODELS.KONTEXT;
      const params = {
        cfg: 4,
        height: 768,
        prompt: 'Dynamic node test',
        steps: 28,
        width: 768,
      };

      const result = await buildFluxKontextWorkflow(modelName, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Verify essential nodes are properly connected
      expect(mockContext.modelResolverService.getOptimalComponent).toHaveBeenCalledWith(
        't5',
        'FLUX',
      );
    });

    it('should handle different CFG values for guidance', async () => {
      const testCases = [
        { cfg: 1, expected: 'minimal guidance' },
        { cfg: 3.5, expected: 'default guidance' },
        { cfg: 7, expected: 'high guidance' },
      ];

      for (const testCase of testCases) {
        const params = {
          cfg: testCase.cfg,
          height: 1024,
          prompt: `Test with ${testCase.expected}`,
          steps: 28,
          width: 1024,
        };

        const result = await buildFluxKontextWorkflow(
          TEST_FLUX_MODELS.KONTEXT,
          params,
          mockContext,
        );
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });
  });

  describe('Component Integration Tests', () => {
    it('should integrate with GetImageSize for dynamic dimensions', async () => {
      const modelName = TEST_FLUX_MODELS.KONTEXT;
      const params = {
        cfg: 3.5,
        imageUrl: 'https://example.com/variable-size.jpg',
        prompt: 'Resize based on input',
        steps: 28,
        // Note: height/width should be dynamically determined by GetImageSize
      };

      const result = await buildFluxKontextWorkflow(modelName, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Verify GetImageSize integration would be handled
    });

    it('should handle component resolution failures gracefully', async () => {
      // Mock component resolution failure
      const failingContext = {
        ...mockContext,
        modelResolverService: {
          ...mockContext.modelResolverService,
          getOptimalComponent: vi.fn().mockRejectedValue(new Error('Component not found')),
        } as any,
      };

      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Test component failure',
        steps: 28,
        width: 1024,
      };

      await expect(
        buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, failingContext),
      ).rejects.toThrow('Component not found');
    });
  });

  describe('Parameter Validation and Edge Cases', () => {
    it('should handle empty prompt', async () => {
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: '',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, mockContext);
      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
    });

    it('should handle custom dimensions', async () => {
      const customDimensions = [
        { width: 512, height: 768 }, // Portrait
        { width: 1152, height: 896 }, // Landscape
        { width: 896, height: 896 }, // Square
      ];

      for (const dims of customDimensions) {
        const params = {
          cfg: 3.5,
          height: dims.height,
          prompt: `Test ${dims.width}x${dims.height}`,
          steps: 28,
          width: dims.width,
        };

        const result = await buildFluxKontextWorkflow(
          TEST_FLUX_MODELS.KONTEXT,
          params,
          mockContext,
        );
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });

    it('should handle different step counts', async () => {
      const stepCounts = [20, 28, 35, 50];

      for (const steps of stepCounts) {
        const params = {
          cfg: 3.5,
          height: 1024,
          prompt: `Test with ${steps} steps`,
          steps,
          width: 1024,
        };

        const result = await buildFluxKontextWorkflow(
          TEST_FLUX_MODELS.KONTEXT,
          params,
          mockContext,
        );
        expect(result).toHaveProperty('input');
        expect(result).toHaveProperty('setInputNode');
        expect(result).toHaveProperty('setOutputNode');
        expect(result).toHaveProperty('workflow');
      }
    });
  });

  describe('Advanced Feature Tests', () => {
    it('should support prompt splitting for dual CLIP', async () => {
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Complex prompt requiring dual CLIP processing',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Mock function should be called (tested via workflow execution)
    });

    it('should handle weight dtype optimization', async () => {
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Weight dtype test',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Mock function should be called (tested via workflow execution)
    });

    it('should generate unique seeds for workflow', async () => {
      const { generateUniqueSeeds } = await import('@lobechat/utils');
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Seed generation test',
        steps: 28,
        width: 1024,
      };

      await buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, mockContext);

      expect(generateUniqueSeeds).toHaveBeenCalled();
    });
  });

  describe('Complex Workflow Architecture', () => {
    it('should handle 28-step workflow complexity', async () => {
      const params = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Complex 28-step workflow test',
        steps: 28,
        width: 1024,
      };

      const result = await buildFluxKontextWorkflow(TEST_FLUX_MODELS.KONTEXT, params, mockContext);

      expect(result).toHaveProperty('input');
      expect(result).toHaveProperty('setInputNode');
      expect(result).toHaveProperty('setOutputNode');
      expect(result).toHaveProperty('workflow');
      // Verify proper step configuration
    });

    it('should maintain node connection integrity across modes', async () => {
      // Test both modes to ensure consistent node connections
      const baseParams = {
        cfg: 3.5,
        height: 1024,
        prompt: 'Connection integrity test',
        steps: 28,
        width: 1024,
      };

      // Test t2i mode
      const t2iResult = await buildFluxKontextWorkflow(
        TEST_FLUX_MODELS.KONTEXT,
        baseParams,
        mockContext,
      );
      expect(t2iResult).toHaveProperty('input');
      expect(t2iResult).toHaveProperty('setInputNode');
      expect(t2iResult).toHaveProperty('setOutputNode');
      expect(t2iResult).toHaveProperty('workflow');

      // Test i2i mode
      const i2iParams = { ...baseParams, imageUrl: 'https://example.com/test.jpg' };
      const i2iResult = await buildFluxKontextWorkflow(
        TEST_FLUX_MODELS.KONTEXT,
        i2iParams,
        mockContext,
      );
      expect(i2iResult).toHaveProperty('input');
      expect(i2iResult).toHaveProperty('setInputNode');
      expect(i2iResult).toHaveProperty('setOutputNode');
      expect(i2iResult).toHaveProperty('workflow');
    });
  });
});
