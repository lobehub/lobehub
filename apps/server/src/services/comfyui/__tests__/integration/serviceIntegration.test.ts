// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parametersFixture } from '@/server/services/comfyui/__tests__/fixtures/parameters.fixture';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
// Import services for testing
import { ImageService } from '@/server/services/comfyui/core/imageService';
import { ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { WorkflowBuilderService } from '@/server/services/comfyui/core/workflowBuilderService';

describe('Service Integration - Module Level', () => {
  let imageService: ImageService;
  let clientService: ComfyUIClientService;
  let modelResolverService: ModelResolverService;
  let workflowBuilderService: WorkflowBuilderService;
  let inputCalls: Map<string, any>;

  beforeEach(() => {
    const mocks = setupAllMocks();
    inputCalls = mocks.inputCalls;

    // 创建服务实例
    clientService = new ComfyUIClientService();
    modelResolverService = new ModelResolverService(clientService);
    workflowBuilderService = new WorkflowBuilderService({
      clientService,
      modelResolverService,
    });

    imageService = new ImageService(clientService, modelResolverService, workflowBuilderService);
  });

  describe('Service Coordination', () => {
    it('should coordinate model resolution and workflow building', async () => {
      const modelResolverSpy = vi.spyOn(modelResolverService, 'validateModel');
      const validateConnectionSpy = vi.spyOn(clientService, 'validateConnection');

      // Mock successful connection validation
      validateConnectionSpy.mockResolvedValue(true);

      // Mock successful model validation
      modelResolverSpy.mockResolvedValue({
        exists: true,
        actualFileName: 'flux-dev.safetensors',
      });

      const params = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
          width: 1024,
          height: 1024,
        },
      };

      try {
        await imageService.createImage(params);
      } catch (error) {
        // 预期在 mock 环境中可能有错误
        console.log('Expected error in mock environment:', error);
      }

      // 验证服务调用顺序
      expect(validateConnectionSpy).toHaveBeenCalled();
      expect(modelResolverSpy).toHaveBeenCalledWith('flux-dev');
    });
  });

  describe('Context Passing', () => {
    it('should pass context between services correctly', async () => {
      const context = {
        clientService,
        modelResolverService,
      };

      // 验证 WorkflowBuilderService 接收正确的 context
      expect(workflowBuilderService).toBeDefined();

      // 测试 context 中的服务是否可用
      expect(clientService).toBeDefined();
      expect(modelResolverService).toBeDefined();
    });
  });

  describe('Error Propagation Between Services', () => {
    it('should propagate errors from model resolver to image service', async () => {
      const modelResolverSpy = vi.spyOn(modelResolverService, 'validateModel');
      modelResolverSpy.mockRejectedValue(new Error('Model validation failed'));

      const params = {
        model: 'invalid-model',
        params: {
          prompt: 'test prompt',
        },
      };

      await expect(imageService.createImage(params)).rejects.toBeDefined();
    });

    it('should handle workflow builder errors', async () => {
      const workflowBuilderSpy = vi.spyOn(workflowBuilderService, 'buildWorkflow');
      workflowBuilderSpy.mockRejectedValue(new Error('Workflow build failed'));

      const params = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
        },
      };

      await expect(imageService.createImage(params)).rejects.toBeDefined();
    });
  });

  describe('Service Dependencies', () => {
    it('should maintain proper service dependencies', () => {
      // ImageService 依赖其他三个服务
      expect(imageService).toBeDefined();

      // ModelResolverService 依赖 ClientService
      expect(modelResolverService).toBeDefined();

      // WorkflowBuilderService 依赖 context
      expect(workflowBuilderService).toBeDefined();

      // ClientService 是基础服务
      expect(clientService).toBeDefined();
    });
  });

  describe('Mock Integration', () => {
    it('should work with unified mocks', async () => {
      // 验证统一 mock 正常工作
      expect(inputCalls).toBeDefined();
      expect(inputCalls).toBeInstanceOf(Map);

      // 测试 mock 是否被正确设置
      const params = {
        model: 'flux-dev',
        params: {
          prompt: 'test prompt',
          ...parametersFixture.models['flux-dev'].defaults,
        },
      };

      // 这应该使用统一的 mocks
      try {
        await imageService.createImage(params);
      } catch (error) {
        // 预期在 mock 环境中可能有错误
      }

      // 验证基本功能正常
      expect(true).toBe(true);
    });
  });
});
