import { ComfyApi } from '@saintno/comfyui-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyUIAuthService } from '@/server/services/comfyui/core/comfyUIAuthService';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ComfyUIConnectionService } from '@/server/services/comfyui/core/comfyUIConnectionService';
import { ServicesError } from '@/server/services/comfyui/errors';
import { ModelResolverError } from '@/server/services/comfyui/errors/modelResolverError';
import { ComfyUIKeyVault } from '@/types/user/settings/keyVaults';

// Mock the SDK
vi.mock('@saintno/comfyui-sdk', () => ({
  CallWrapper: vi.fn(),
  ComfyApi: vi.fn(),
}));

// Mock the modular services
vi.mock('@/server/services/comfyui/core/comfyUIAuthService');
vi.mock('@/server/services/comfyui/core/comfyUIConnectionService');

describe('ComfyUIClientService', () => {
  let service: ComfyUIClientService;
  let mockClient: any;
  let mockAuthService: any;
  let mockConnectionService: any;
  let originalDateNow: () => number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDateNow = Date.now;

    // Create mock client
    mockClient = {
      fetchApi: vi.fn(),
      getCheckpoints: vi.fn(),
      getLoras: vi.fn(),
      getNodeDefs: vi.fn(),
      getPathImage: vi.fn(),
      getSamplerInfo: vi.fn(),
      init: vi.fn(),
      uploadImage: vi.fn(),
    };

    // Create mock services
    mockAuthService = {
      getCredentials: vi.fn().mockReturnValue(undefined),
      getAuthHeaders: vi.fn().mockReturnValue(undefined),
    };

    mockConnectionService = {
      validateConnection: vi.fn().mockResolvedValue(true),
      getStatus: vi.fn().mockReturnValue({
        isValidated: false,
        lastValidationTime: null,
        timeUntilExpiry: null,
      }),
    };

    // Mock constructors
    vi.mocked(ComfyApi).mockImplementation(() => mockClient);
    vi.mocked(ComfyUIAuthService).mockImplementation(() => mockAuthService);
    vi.mocked(ComfyUIConnectionService).mockImplementation(() => mockConnectionService);
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      service = new ComfyUIClientService();

      expect(ComfyUIAuthService).toHaveBeenCalledWith({});
      expect(ComfyUIConnectionService).toHaveBeenCalled();
      expect(ComfyApi).toHaveBeenCalledWith(expect.stringContaining('http'), undefined, {
        credentials: undefined,
      });
      expect(mockClient.init).toHaveBeenCalled();
    });

    it('should initialize with custom options', () => {
      const options: ComfyUIKeyVault = {
        authType: 'basic',
        baseURL: 'http://custom:8188',
        password: 'pass',
        username: 'user',
      };

      service = new ComfyUIClientService(options);

      expect(ComfyUIAuthService).toHaveBeenCalledWith(options);
      expect(ComfyUIConnectionService).toHaveBeenCalled();
      expect(ComfyApi).toHaveBeenCalledWith('http://custom:8188', undefined, {
        credentials: undefined,
      });
      expect(mockClient.init).toHaveBeenCalled();
    });

    it('should handle auth service errors during initialization', () => {
      // Mock AuthService constructor to throw
      vi.mocked(ComfyUIAuthService).mockImplementation(() => {
        throw new ServicesError('Invalid auth config', ServicesError.Reasons.INVALID_ARGS);
      });

      expect(() => new ComfyUIClientService({ authType: 'basic' })).toThrow();

      // Verify it throws an error (ErrorHandlerService wraps it into TRPCError)
      try {
        new ComfyUIClientService({ authType: 'basic' });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.cause).toHaveProperty('errorType', 'InvalidComfyUIArgs');
        expect(error.cause).toHaveProperty('provider', 'comfyui');
      }
    });
  });

  describe('uploadImage', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should successfully upload an image', async () => {
      // Setup mock
      const mockBuffer = Buffer.from('test image data');
      const mockFileName = 'test.png';
      const mockResult = {
        info: {
          filename: 'uploaded_test.png',
        },
      };

      mockClient.uploadImage.mockResolvedValue(mockResult);

      // Execute
      const result = await service.uploadImage(mockBuffer, mockFileName);

      // Verify
      expect(result).toBe('uploaded_test.png');
      expect(mockClient.uploadImage).toHaveBeenCalledWith(mockBuffer, mockFileName);
    });

    it('should handle upload failure when result is null', async () => {
      // Setup
      mockClient.uploadImage.mockResolvedValue(null);

      // Execute and verify
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toThrow(
        'Failed to upload image to ComfyUI server',
      );
    });

    it('should handle network errors during upload', async () => {
      // Setup
      const networkError = new TypeError('Failed to fetch');
      mockClient.uploadImage.mockRejectedValue(networkError);

      // Execute and verify - uploadImage just re-throws without transformation
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toThrow(
        'Failed to fetch',
      );
    });

    it('should handle 401 authentication error', async () => {
      // Setup
      const authError = new Error('Request failed with status: 401');
      mockClient.uploadImage.mockRejectedValue(authError);

      // Execute and verify - uploadImage just re-throws without transformation
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toThrow(
        'Request failed with status: 401',
      );
    });

    it('should handle 403 forbidden error', async () => {
      // Setup
      const forbiddenError = new Error('Request failed with status: 403');
      mockClient.uploadImage.mockRejectedValue(forbiddenError);

      // Execute and verify - uploadImage just re-throws without transformation
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toThrow(
        'Request failed with status: 403',
      );
    });

    it('should handle 500+ server errors', async () => {
      // Setup
      const serverError = new Error('Request failed with status: 503');
      mockClient.uploadImage.mockRejectedValue(serverError);

      // Execute and verify - uploadImage just re-throws without transformation
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toThrow(
        'Request failed with status: 503',
      );
    });

    it('should handle unknown errors', async () => {
      // Setup
      const unknownError = 'Some unexpected error string';
      mockClient.uploadImage.mockRejectedValue(unknownError);

      // Execute and verify - uploadImage just re-throws without transformation
      await expect(service.uploadImage(Buffer.from('data'), 'file.png')).rejects.toBe(
        'Some unexpected error string',
      );
    });

    it('should support Blob upload', async () => {
      // Setup
      const mockBlob = new Blob(['test data']);
      const mockResult = {
        info: { filename: 'blob_upload.png' },
      };

      mockClient.uploadImage.mockResolvedValue(mockResult);

      // Execute
      const result = await service.uploadImage(mockBlob, 'blob.png');

      // Verify
      expect(result).toBe('blob_upload.png');
      expect(mockClient.uploadImage).toHaveBeenCalledWith(mockBlob, 'blob.png');
    });
  });

  describe('executeWorkflow', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should execute workflow successfully', async () => {
      // Import CallWrapper mock
      const { CallWrapper } = await import('@saintno/comfyui-sdk');

      // Setup mock workflow
      const mockWorkflow = { id: 'test-workflow' };
      const mockResult = {
        images: {
          images: [{ data: 'base64' }],
        },
      };

      // Create CallWrapper mock instance
      const mockCallWrapper = {
        onFailed: vi.fn().mockReturnThis(),
        onFinished: vi.fn().mockReturnThis(),
        onProgress: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      // Setup CallWrapper mock
      vi.mocked(CallWrapper).mockImplementation(() => mockCallWrapper as any);

      // Simulate successful execution
      mockCallWrapper.run.mockImplementation(() => {
        const finishCallback = mockCallWrapper.onFinished.mock.calls[0][0];
        finishCallback(mockResult);
      });

      // Execute
      const result = await service.executeWorkflow(mockWorkflow as any);

      // Verify
      expect(result).toEqual(mockResult);
      expect(CallWrapper).toHaveBeenCalledWith(mockClient, mockWorkflow);
    });

    it('should handle workflow execution failure', async () => {
      const { CallWrapper } = await import('@saintno/comfyui-sdk');

      const mockWorkflow = { id: 'test' };
      const mockError = new Error('Workflow failed');

      const mockCallWrapper = {
        onFailed: vi.fn().mockReturnThis(),
        onFinished: vi.fn().mockReturnThis(),
        onProgress: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      vi.mocked(CallWrapper).mockImplementation(() => mockCallWrapper as any);

      // Simulate failure
      mockCallWrapper.run.mockImplementation(() => {
        const failCallback = mockCallWrapper.onFailed.mock.calls[0][0];
        failCallback(mockError);
      });

      // Execute and verify - executeWorkflow just passes through the error
      await expect(service.executeWorkflow(mockWorkflow as any)).rejects.toThrow('Workflow failed');
    });

    it('should call progress callback', async () => {
      const { CallWrapper } = await import('@saintno/comfyui-sdk');

      const mockWorkflow = { id: 'test' };
      const mockProgress = { step: 1, total: 10 };
      const progressCallback = vi.fn();

      const mockCallWrapper = {
        onFailed: vi.fn().mockReturnThis(),
        onFinished: vi.fn().mockReturnThis(),
        onProgress: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      vi.mocked(CallWrapper).mockImplementation(() => mockCallWrapper as any);

      // Simulate progress and completion
      mockCallWrapper.run.mockImplementation(() => {
        const progressCb = mockCallWrapper.onProgress.mock.calls[0][0];
        progressCb(mockProgress);

        const finishCb = mockCallWrapper.onFinished.mock.calls[0][0];
        finishCb({ images: { images: [] } });
      });

      // Execute
      await service.executeWorkflow(mockWorkflow as any, progressCallback);

      // Verify
      expect(progressCallback).toHaveBeenCalledWith(mockProgress);
    });
  });

  describe('validateConnection', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should delegate to connection service', async () => {
      mockConnectionService.validateConnection.mockResolvedValue(true);

      const result = await service.validateConnection();

      expect(result).toBe(true);
      expect(mockConnectionService.validateConnection).toHaveBeenCalledWith(
        expect.stringContaining('http'), // baseURL
        undefined, // auth headers (undefined for no auth)
      );
    });

    it('should pass auth headers to connection service', async () => {
      const authHeaders = { Authorization: 'Bearer test-token' };
      mockAuthService.getAuthHeaders.mockReturnValue(authHeaders);
      mockConnectionService.validateConnection.mockResolvedValue(true);

      const result = await service.validateConnection();

      expect(result).toBe(true);
      expect(mockConnectionService.validateConnection).toHaveBeenCalledWith(
        expect.stringContaining('http'), // baseURL
        authHeaders,
      );
    });

    it('should handle connection service errors', async () => {
      const connectionError = new ServicesError(
        'Connection failed',
        ServicesError.Reasons.CONNECTION_FAILED,
      );
      mockConnectionService.validateConnection.mockRejectedValue(connectionError);

      await expect(service.validateConnection()).rejects.toThrow(connectionError);
    });
  });

  // fetchApi and getObjectInfo tests removed
  // These methods should not be used directly
  // Use SDK methods: getCheckpoints(), getNodeDefs(), getLoras(), getSamplerInfo()

  describe('getPathImage', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should delegate to client getPathImage', () => {
      // Setup
      const mockImageInfo = { filename: 'test.png' };
      const expectedPath = 'https://server/image/test.png';
      mockClient.getPathImage.mockReturnValue(expectedPath);

      // Execute
      const result = service.getPathImage(mockImageInfo);

      // Verify
      expect(result).toBe(expectedPath);
      expect(mockClient.getPathImage).toHaveBeenCalledWith(mockImageInfo);
    });
  });

  describe('getAuthHeaders', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should delegate to auth service', () => {
      const expectedHeaders = { Authorization: 'Bearer test-token' };
      mockAuthService.getAuthHeaders.mockReturnValue(expectedHeaders);

      const headers = service.getAuthHeaders();

      expect(headers).toEqual(expectedHeaders);
      expect(mockAuthService.getAuthHeaders).toHaveBeenCalled();
    });

    it('should return undefined when auth service returns undefined', () => {
      mockAuthService.getAuthHeaders.mockReturnValue(undefined);

      const headers = service.getAuthHeaders();

      expect(headers).toBeUndefined();
      expect(mockAuthService.getAuthHeaders).toHaveBeenCalled();
    });
  });

  describe('service access methods', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
    });

    it('should provide access to auth service', () => {
      const authService = service.getAuthService();
      expect(authService).toBe(mockAuthService);
    });

    it('should provide access to connection service', () => {
      const connectionService = service.getConnectionService();
      expect(connectionService).toBe(mockConnectionService);
    });

    it('should provide connection status', () => {
      const expectedStatus = {
        isValidated: true,
        lastValidationTime: Date.now(),
        timeUntilExpiry: 300000,
      };
      mockConnectionService.getStatus.mockReturnValue(expectedStatus);

      const status = service.getConnectionStatus();

      expect(status).toEqual(expectedStatus);
      expect(mockConnectionService.getStatus).toHaveBeenCalled();
    });
  });

  describe('getCheckpoints', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
      mockClient.getCheckpoints = vi.fn();
    });

    it('should get checkpoints successfully', async () => {
      const mockCheckpoints = ['flux1-dev.safetensors', 'sd3.5_large.safetensors'];
      mockClient.getCheckpoints.mockResolvedValue(mockCheckpoints);

      const result = await service.getCheckpoints();

      expect(result).toEqual(mockCheckpoints);
      expect(mockClient.getCheckpoints).toHaveBeenCalled();
    });

    it('should handle error when getting checkpoints', async () => {
      mockClient.getCheckpoints.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getCheckpoints()).rejects.toThrow();
    });

    it('should cache checkpoints for 1 minute TTL', async () => {
      const mockCheckpoints = ['flux1-dev.safetensors', 'sd3.5_large.safetensors'];
      mockClient.getCheckpoints.mockResolvedValue(mockCheckpoints);

      // First call
      const result1 = await service.getCheckpoints();
      expect(result1).toEqual(mockCheckpoints);
      expect(mockClient.getCheckpoints).toHaveBeenCalledTimes(1);

      // Second call within TTL - should use cache
      const result2 = await service.getCheckpoints();
      expect(result2).toEqual(mockCheckpoints);
      expect(mockClient.getCheckpoints).toHaveBeenCalledTimes(1); // Still only 1 call

      // Mock time passing (simulate cache expiry)
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 1000); // 61 seconds later

      // Third call after TTL expired - should make new SDK call
      const result3 = await service.getCheckpoints();
      expect(result3).toEqual(mockCheckpoints);
      expect(mockClient.getCheckpoints).toHaveBeenCalledTimes(2); // Now 2 calls
    });
  });

  describe('getLoras', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
      mockClient.getLoras = vi.fn();
    });

    it('should get LoRAs successfully', async () => {
      const mockLoras = ['lora1.safetensors', 'lora2.safetensors'];
      mockClient.getLoras.mockResolvedValue(mockLoras);

      const result = await service.getLoras();

      expect(result).toEqual(mockLoras);
      expect(mockClient.getLoras).toHaveBeenCalled();
    });

    it('should handle error when getting LoRAs', async () => {
      mockClient.getLoras.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getLoras()).rejects.toThrow();
    });

    it('should cache LoRAs for 1 minute TTL', async () => {
      const mockLoras = ['lora1.safetensors', 'lora2.safetensors'];
      mockClient.getLoras.mockResolvedValue(mockLoras);

      // First call
      const result1 = await service.getLoras();
      expect(result1).toEqual(mockLoras);
      expect(mockClient.getLoras).toHaveBeenCalledTimes(1);

      // Second call within TTL - should use cache
      const result2 = await service.getLoras();
      expect(result2).toEqual(mockLoras);
      expect(mockClient.getLoras).toHaveBeenCalledTimes(1); // Still only 1 call

      // Mock time passing (simulate cache expiry)
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 1000); // 61 seconds later

      // Third call after TTL expired - should make new SDK call
      const result3 = await service.getLoras();
      expect(result3).toEqual(mockLoras);
      expect(mockClient.getLoras).toHaveBeenCalledTimes(2); // Now 2 calls
    });
  });

  describe('getNodeDefs', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
      mockClient.getNodeDefs = vi.fn();
    });

    it('should get node definitions with caching', async () => {
      const mockNodeDefs = {
        CheckpointLoaderSimple: {
          input: {
            required: {
              ckpt_name: [['flux1-dev.safetensors']],
            },
          },
        },
      };
      mockClient.getNodeDefs.mockResolvedValue(mockNodeDefs);

      // First call - should fetch from API
      const result1 = await service.getNodeDefs();
      expect(result1).toEqual(mockNodeDefs);
      expect(mockClient.getNodeDefs).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await service.getNodeDefs();
      expect(result2).toEqual(mockNodeDefs);
      expect(mockClient.getNodeDefs).toHaveBeenCalledTimes(1); // Still 1, used cache

      // Get specific node - should return full cache since SDK doesn't support filtering
      const result3 = await service.getNodeDefs('CheckpointLoaderSimple');
      expect(result3).toEqual(mockNodeDefs);
      expect(mockClient.getNodeDefs).toHaveBeenCalledTimes(1); // Still 1, used cache
    });

    it('should refresh cache after TTL expires', async () => {
      const mockNodeDefs1 = { node1: {} };
      const mockNodeDefs2 = { node2: {} };

      mockClient.getNodeDefs
        .mockResolvedValueOnce(mockNodeDefs1)
        .mockResolvedValueOnce(mockNodeDefs2);

      // First call
      const result1 = await service.getNodeDefs();
      expect(result1).toEqual(mockNodeDefs1);

      // Simulate time passing (more than 1 minute)
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 61_000);

      // Second call after TTL - should fetch again
      const result2 = await service.getNodeDefs();
      expect(result2).toEqual(mockNodeDefs2);
      expect(mockClient.getNodeDefs).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = originalNow;
    });

    it('should handle error when getting node definitions', async () => {
      mockClient.getNodeDefs.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getNodeDefs()).rejects.toThrow();
    });
  });

  describe('getSamplerInfo', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
      mockClient.getSamplerInfo = vi.fn();
    });

    it('should get sampler info successfully', async () => {
      const mockSDKResponse = {
        sampler: ['euler', 'ddim'],
        scheduler: ['normal', 'karras'],
      };
      mockClient.getSamplerInfo.mockResolvedValue(mockSDKResponse);

      const result = await service.getSamplerInfo();

      // Service now returns samplerName instead of sampler for consistency
      expect(result).toEqual({
        samplerName: ['euler', 'ddim'],
        scheduler: ['normal', 'karras'],
      });
      expect(mockClient.getSamplerInfo).toHaveBeenCalled();
    });

    it('should handle error when getting sampler info', async () => {
      mockClient.getSamplerInfo.mockRejectedValue(new Error('Failed to fetch'));

      await expect(service.getSamplerInfo()).rejects.toThrow();
    });
  });

  describe('uploadImage', () => {
    beforeEach(() => {
      service = new ComfyUIClientService();
      mockClient.uploadImage = vi.fn();
    });

    it('should upload image successfully', async () => {
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' });
      const mockResponse = {
        info: {
          filename: 'uploaded.png',
          type: 'input',
        },
      };

      mockClient.uploadImage.mockResolvedValue(mockResponse);

      const result = await service.uploadImage(mockFile, 'test.png');

      expect(result).toEqual('uploaded.png');
      expect(mockClient.uploadImage).toHaveBeenCalledWith(mockFile, 'test.png');
    });

    it('should handle upload error', async () => {
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' });

      mockClient.uploadImage.mockRejectedValue(new Error('Upload failed'));

      await expect(service.uploadImage(mockFile, 'test.png')).rejects.toThrow();
    });
  });
});
