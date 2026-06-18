// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parametersFixture } from '@/server/services/comfyui/__tests__/fixtures/parameters.fixture';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
// Import services for testing
import { ImageService } from '@/server/services/comfyui/core/imageService';
import { ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { WorkflowBuilderService } from '@/server/services/comfyui/core/workflowBuilderService';

describe('Error Handling - SDK Integration', () => {
  let imageService: ImageService;
  let inputCalls: Map<string, any>;

  beforeEach(() => {
    const mocks = setupAllMocks();
    inputCalls = mocks.inputCalls;

    // Create service instances
    const clientService = new ComfyUIClientService();
    const modelResolverService = new ModelResolverService(clientService);
    const workflowBuilderService = new WorkflowBuilderService({
      clientService,
      modelResolverService,
    });

    imageService = new ImageService(clientService, modelResolverService, workflowBuilderService);
  });

  describe('SDK Error Handling', () => {
    it('should catch and transform SDK errors', async () => {
      // This test relies on the unified mock system for CallWrapper

      const params = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
        },
      };

      // Should catch and transform errors
      await expect(imageService.createImage(params)).rejects.toThrow();
    });

    it('should handle workflow build errors gracefully', async () => {
      const incompleteParams = {
        model: 'flux-dev',
        params: {
          prompt: '', // Empty prompt may cause issues
        },
      };

      // Should not crash, should return meaningful error
      await expect(imageService.createImage(incompleteParams)).rejects.toThrow();
    });

    it('should handle invalid model errors', async () => {
      const invalidModelParams = {
        model: 'non-existent-model',
        params: {
          prompt: 'test prompt',
        },
      };

      // 应该优雅地处理无效模型
      await expect(imageService.createImage(invalidModelParams)).rejects.toThrow();
    });
  });

  describe('Parameter Validation Errors', () => {
    it('should validate required parameters', async () => {
      const missingParams = {
        model: 'flux-dev',
        params: { prompt: '' }, // 缺少必要参数，但至少包含必需的prompt
      };

      // 应该验证并报错
      await expect(imageService.createImage(missingParams)).rejects.toThrow();
    });

    it('should handle parameter boundary violations gracefully', async () => {
      const invalidParams = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          cfg: -1, // 无效值
          steps: 1000, // 超出范围
        },
      };

      // 应该处理边界违规
      await expect(imageService.createImage(invalidParams)).rejects.toThrow();
    });
  });

  describe('Service Error Propagation', () => {
    it('should propagate model resolution errors', async () => {
      // Mock 模型解析失败
      vi.spyOn(ModelResolverService.prototype, 'validateModel').mockRejectedValue(
        new Error('Model not found'),
      );

      const params = {
        model: 'unknown-model',
        params: {
          prompt: 'test prompt',
        },
      };

      await expect(imageService.createImage(params)).rejects.toThrow();
    });

    it('should handle connection validation failures', async () => {
      // Mock 连接验证失败
      vi.spyOn(ComfyUIClientService.prototype, 'validateConnection').mockRejectedValue(
        new Error('Connection failed'),
      );

      const params = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
        },
      };

      await expect(imageService.createImage(params)).rejects.toThrow();
    });
  });
});
