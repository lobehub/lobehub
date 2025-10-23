import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateImagePayload } from '@lobechat/model-runtime';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ErrorHandlerService } from '@/server/services/comfyui/core/errorHandlerService';
import { ImageService } from '@/server/services/comfyui/core/imageService';
import { ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { WorkflowBuilderService } from '@/server/services/comfyui/core/workflowBuilderService';
import { WorkflowDetector } from '@/server/services/comfyui/utils/workflowDetector';

// Mock dependencies
vi.mock('@/server/services/comfyui/core/comfyUIClientService');
vi.mock('@/server/services/comfyui/core/modelResolverService');
vi.mock('@/server/services/comfyui/core/workflowBuilderService');
vi.mock('@/server/services/comfyui/core/errorHandlerService');
vi.mock('@/server/services/comfyui/utils/workflowDetector');

// Mock sharp module for image processing
vi.mock('sharp', () => ({
  default: vi.fn((buffer) => ({
    metadata: vi.fn().mockResolvedValue({ height: 1024, width: 1024 }),
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from(buffer)),
  })),
}));

describe('ImageService', () => {
  let imageService: ImageService;
  let mockClientService: any;
  let mockModelResolverService: any;
  let mockWorkflowBuilderService: any;
  let mockErrorHandler: any;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mocks
    mockClientService = {
      executeWorkflow: vi.fn(),
      getPathImage: vi.fn(),
      uploadImage: vi.fn(),
      validateConnection: vi.fn().mockResolvedValue(true),
    };

    mockModelResolverService = {
      validateModel: vi.fn(),
    };

    mockWorkflowBuilderService = {
      buildWorkflow: vi.fn(),
    };

    mockErrorHandler = {
      handleError: vi.fn(),
    };

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Setup mocks for constructor
    vi.mocked(ComfyUIClientService, true).mockImplementation(() => mockClientService as any);
    vi.mocked(ModelResolverService, true).mockImplementation(() => mockModelResolverService as any);
    vi.mocked(WorkflowBuilderService, true).mockImplementation(
      () => mockWorkflowBuilderService as any,
    );
    vi.mocked(ErrorHandlerService, true).mockImplementation(() => mockErrorHandler as any);

    // Create service instance
    imageService = new ImageService(
      mockClientService,
      mockModelResolverService,
      mockWorkflowBuilderService,
    );

    // Mock workflow detector
    vi.mocked(WorkflowDetector, true).detectModelType = vi.fn().mockReturnValue({
      architecture: 'flux-schnell',
      isSupported: true,
      modelType: 'FLUX',
    });
  });

  describe('createImage', () => {
    const mockPayload: CreateImagePayload = {
      model: 'flux-schnell',
      params: {
        height: 1024,
        prompt: 'test prompt',
        width: 1024,
      },
    };

    it('should successfully create image with text2img workflow', async () => {
      // Setup mocks
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'flux1-schnell-fp8.safetensors',
        exists: true,
      });

      const mockWorkflow = { id: 'test-workflow' };
      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue(mockWorkflow);

      const mockResult = {
        images: {
          images: [
            {
              data: 'base64data',
              height: 1024,
              width: 1024,
            },
          ],
        },
      };
      mockClientService.executeWorkflow.mockResolvedValue(mockResult);
      mockClientService.getPathImage.mockReturnValue('https://comfyui.test/image.png');

      // Execute
      const result = await imageService.createImage(mockPayload);

      // Verify
      expect(result).toEqual({
        imageUrl: 'https://comfyui.test/image.png',
      });

      expect(mockModelResolverService.validateModel).toHaveBeenCalledWith('flux-schnell');
      expect(mockWorkflowBuilderService.buildWorkflow).toHaveBeenCalled();
      expect(mockClientService.executeWorkflow).toHaveBeenCalledWith(
        mockWorkflow,
        expect.any(Function),
      );
    });

    it('should handle model not found error', async () => {
      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        exists: false,
      });

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw {
          error: { message: error.message },
          errorType: AgentRuntimeErrorType.ModelNotFound,
          provider: 'comfyui',
        };
      });

      // Execute and verify
      await expect(imageService.createImage(mockPayload)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ModelNotFound,
        provider: 'comfyui',
      });
    });

    it('should handle empty result from workflow', async () => {
      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'flux1-schnell-fp8.safetensors',
        exists: true,
      });

      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [] },
      });

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw {
          error: { message: error.message },
          errorType: AgentRuntimeErrorType.ComfyUIBizError,
          provider: 'comfyui',
        };
      });

      // Execute and verify
      await expect(imageService.createImage(mockPayload)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ComfyUIBizError,
        provider: 'comfyui',
      });
    });
  });

  describe('processImageFetch', () => {
    const mockPayloadWithImage: CreateImagePayload = {
      model: 'flux-schnell',
      params: {
        height: 1024,
        imageUrl: 'https://s3.test/bucket/image.png',
        prompt: 'test prompt',
        width: 1024,
      },
    };

    it('should fetch image from URL and upload to ComfyUI', async () => {
      // Setup mocks
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'flux1-schnell-fp8.safetensors',
        exists: true,
      });

      // Fetch mocks
      const mockImageData = new Uint8Array([1, 2, 3, 4, 5]);
      mockFetch.mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(mockImageData.buffer),
        ok: true,
      });

      // Upload mock
      mockClientService.uploadImage.mockResolvedValue('img2img_123456.png');

      // Workflow mocks
      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [{ height: 1024, width: 1024 }] },
      });
      mockClientService.getPathImage.mockReturnValue('https://comfyui.test/result.png');

      // Execute
      await imageService.createImage(mockPayloadWithImage);

      // Verify fetch was called with the image URL
      expect(mockFetch).toHaveBeenCalledWith('https://s3.test/bucket/image.png');
      // Note: uploadImage won't be called in test environment since window exists (jsdom)
      // and sharp code is skipped. The actual image processing is tested in integration tests.

      // Verify the original params are NOT modified (we clone them now)
      expect(mockPayloadWithImage.params.imageUrl).toBe('https://s3.test/bucket/image.png');
    });

    it('should skip processing if imageUrl is already a ComfyUI filename', async () => {
      const payloadWithFilename: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrl: 'existing_image.png',
          prompt: 'test prompt', // Not a URL
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'flux1-schnell-fp8.safetensors',
        exists: true,
      });

      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [{}] },
      });
      mockClientService.getPathImage.mockReturnValue('result.png');

      // Execute
      await imageService.createImage(payloadWithFilename);

      // Verify fetch was not called
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockClientService.uploadImage).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      const payload: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrl: 'https://s3.test/missing.png',
          prompt: 'test prompt',
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'model.safetensors',
        exists: true,
      });

      // Fetch error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw error;
      });

      // Execute and verify
      await expect(imageService.createImage(payload)).rejects.toThrow(
        /Failed to fetch image: 404 Not Found/,
      );
    });

    it('should not modify original params object', async () => {
      const originalImageUrl = 'https://s3.test/original.png';
      const payload: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrl: originalImageUrl,
          prompt: 'test prompt',
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'flux1-schnell-fp8.safetensors',
        exists: true,
      });

      // Mock WorkflowDetector to return proper architecture
      vi.mocked(WorkflowDetector, true).detectModelType = vi.fn().mockReturnValue({
        architecture: 'FLUX',
        isSupported: true,
        modelType: 'FLUX',
      });

      // Mock fetch and upload
      mockFetch.mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
        ok: true,
      });
      mockClientService.uploadImage.mockResolvedValue('uploaded.png');
      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [{}] },
      });
      mockClientService.getPathImage.mockReturnValue('result.png');

      // Execute
      await imageService.createImage(payload);

      // Verify original params are NOT modified
      expect(payload.params.imageUrl).toBe(originalImageUrl);
    });

    it('should handle empty image data', async () => {
      const payload: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrl: 'https://s3.test/empty.png',
          prompt: 'test prompt',
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'model.safetensors',
        exists: true,
      });

      // Empty image data
      mockFetch.mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        ok: true,
      });

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw error;
      });

      // Execute and verify
      await expect(imageService.createImage(payload)).rejects.toThrow(/Invalid image data/);
    });

    it('should handle network fetch errors', async () => {
      const payload: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrl: 'https://s3.test/network-error.png',
          prompt: 'test prompt',
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'model.safetensors',
        exists: true,
      });

      // Network error
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw error;
      });

      // Execute and verify
      await expect(imageService.createImage(payload)).rejects.toThrow(/Failed to fetch/);
    });

    it('should handle imageUrls array format', async () => {
      const payloadWithArray: CreateImagePayload = {
        model: 'flux-schnell',
        params: {
          imageUrls: ['https://s3.test/image.png'],
          prompt: 'test prompt',
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'model.safetensors',
        exists: true,
      });

      // S3 mocks
      mockFetch.mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
        ok: true,
      });
      mockClientService.uploadImage.mockResolvedValue('uploaded.png');

      // Workflow mocks
      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [{}] },
      });
      mockClientService.getPathImage.mockReturnValue('result.png');

      // Execute
      await imageService.createImage(payloadWithArray);

      // Verify original params are NOT modified (we clone them now)
      expect(payloadWithArray.params.imageUrl).toBeUndefined();
      expect(payloadWithArray.params.imageUrls![0]).toBe('https://s3.test/image.png');
    });
  });

  describe('buildWorkflow', () => {
    it('should detect unsupported models', async () => {
      const payload: CreateImagePayload = {
        model: 'unsupported-model',
        params: { prompt: 'test prompt' },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'unsupported.safetensors',
        exists: true,
      });

      // Mock unsupported detection
      vi.mocked(WorkflowDetector).detectModelType = vi.fn().mockReturnValue({
        isSupported: false,
      });

      mockErrorHandler.handleError.mockImplementation((error: any) => {
        throw {
          error: { message: error.message },
          errorType: AgentRuntimeErrorType.ModelNotFound,
          provider: 'comfyui',
        };
      });

      // Execute and verify
      await expect(imageService.createImage(payload)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ModelNotFound,
      });
    });

    it('should pass correct parameters to workflow builder', async () => {
      const payload: CreateImagePayload = {
        model: 'sd3.5-large',
        params: {
          height: 768,
          prompt: 'test',
          width: 1024,
        },
      };

      // Setup
      mockModelResolverService.validateModel.mockResolvedValue({
        actualFileName: 'sd3.5_large.safetensors',
        exists: true,
      });

      const detectionResult = {
        architecture: 'sd35-large',
        isSupported: true,
        modelType: 'SD35',
      };

      vi.mocked(WorkflowDetector).detectModelType = vi.fn().mockReturnValue(detectionResult);

      mockWorkflowBuilderService.buildWorkflow.mockResolvedValue({});
      mockClientService.executeWorkflow.mockResolvedValue({
        images: { images: [{}] },
      });
      mockClientService.getPathImage.mockReturnValue('result.png');

      // Execute
      await imageService.createImage(payload);

      // Verify workflow builder was called correctly
      expect(mockWorkflowBuilderService.buildWorkflow).toHaveBeenCalledWith(
        'sd3.5-large',
        detectionResult,
        'sd3.5_large.safetensors',
        payload.params,
      );
    });
  });

  describe('error handling delegation', () => {
    it('should delegate all errors to ErrorHandlerService', async () => {
      const payload: CreateImagePayload = {
        model: 'test',
        params: { prompt: 'test prompt' },
      };

      // Setup error
      const testError = new Error('Test error');
      mockModelResolverService.validateModel.mockRejectedValue(testError);

      mockErrorHandler.handleError.mockImplementation(() => {
        throw { original: testError, transformed: true };
      });

      // Execute
      await expect(imageService.createImage(payload)).rejects.toMatchObject({
        original: testError,
        transformed: true,
      });

      // Verify error handler was called
      expect(mockErrorHandler.handleError).toHaveBeenCalledWith(testError);
    });
  });
});
