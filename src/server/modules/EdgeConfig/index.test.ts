// @vitest-environment node
import { EdgeConfigClient } from '@vercel/edge-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EdgeConfig } from './index';

// Mock dependencies
vi.mock('@vercel/edge-config', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    VERCEL_EDGE_CONFIG: '',
  },
}));

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('EdgeConfig', () => {
  let mockClient: Partial<EdgeConfigClient>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockCreateClient: ReturnType<typeof vi.fn>;
  let mockAppEnv: { VERCEL_EDGE_CONFIG: string | undefined | null };
  let edgeConfig: EdgeConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock functions
    mockGet = vi.fn();
    mockGetAll = vi.fn();

    // Setup mock client
    mockClient = {
      get: mockGet,
      getAll: mockGetAll,
    };

    // Get the mocked createClient and setup its return value
    const { createClient } = await import('@vercel/edge-config');
    mockCreateClient = vi.mocked(createClient);
    mockCreateClient.mockReturnValue(mockClient as EdgeConfigClient);

    // Get reference to the mocked appEnv
    const { appEnv } = await import('@/envs/app');
    mockAppEnv = appEnv as any;
  });

  describe('isEnabled', () => {
    it('should return true when VERCEL_EDGE_CONFIG is set', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(true);
    });

    it('should return false when VERCEL_EDGE_CONFIG is not set', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = '';

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });

    it('should return false when VERCEL_EDGE_CONFIG is undefined', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = undefined;

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });

    it('should return false when VERCEL_EDGE_CONFIG is null', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = null;

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('client getter', () => {
    it('should create and return a client when VERCEL_EDGE_CONFIG is set', () => {
      const testUrl = 'https://edge-config.vercel.com/test';
      mockAppEnv.VERCEL_EDGE_CONFIG = testUrl;

      edgeConfig = new EdgeConfig();
      const client = edgeConfig.client;

      expect(client).toBe(mockClient);
      expect(mockCreateClient).toHaveBeenCalledWith(testUrl);
    });

    it('should throw an error when VERCEL_EDGE_CONFIG is not set', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = '';

      edgeConfig = new EdgeConfig();

      expect(() => edgeConfig.client).toThrow('VERCEL_EDGE_CONFIG is not set');
    });

    it('should throw an error when VERCEL_EDGE_CONFIG is undefined', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = undefined;

      edgeConfig = new EdgeConfig();

      expect(() => edgeConfig.client).toThrow('VERCEL_EDGE_CONFIG is not set');
    });
  });

  describe('getAgentRestrictions', () => {
    beforeEach(() => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();
    });

    it('should retrieve agent blacklist and whitelist', async () => {
      const mockRestrictions = {
        assistant_blacklist: ['agent1', 'agent2'],
        assistant_whitelist: ['agent3', 'agent4'],
      };

      mockGetAll.mockResolvedValue(mockRestrictions);

      const result = await edgeConfig.getAgentRestrictions();

      expect(mockGetAll).toHaveBeenCalledWith(['assistant_blacklist', 'assistant_whitelist']);
      expect(result).toEqual({
        blacklist: ['agent1', 'agent2'],
        whitelist: ['agent3', 'agent4'],
      });
    });

    it('should handle missing blacklist', async () => {
      const mockRestrictions = {
        assistant_blacklist: undefined,
        assistant_whitelist: ['agent3', 'agent4'],
      };

      mockGetAll.mockResolvedValue(mockRestrictions);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: undefined,
        whitelist: ['agent3', 'agent4'],
      });
    });

    it('should handle missing whitelist', async () => {
      const mockRestrictions = {
        assistant_blacklist: ['agent1', 'agent2'],
        assistant_whitelist: undefined,
      };

      mockGetAll.mockResolvedValue(mockRestrictions);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: ['agent1', 'agent2'],
        whitelist: undefined,
      });
    });

    it('should handle both blacklist and whitelist missing', async () => {
      const mockRestrictions = {
        assistant_blacklist: undefined,
        assistant_whitelist: undefined,
      };

      mockGetAll.mockResolvedValue(mockRestrictions);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: undefined,
        whitelist: undefined,
      });
    });

    it('should handle empty arrays', async () => {
      const mockRestrictions = {
        assistant_blacklist: [],
        assistant_whitelist: [],
      };

      mockGetAll.mockResolvedValue(mockRestrictions);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: [],
        whitelist: [],
      });
    });

    it('should propagate errors from the client', async () => {
      const error = new Error('Network error');
      mockGetAll.mockRejectedValue(error);

      await expect(edgeConfig.getAgentRestrictions()).rejects.toThrow('Network error');
    });
  });

  describe('getFeatureFlags', () => {
    beforeEach(() => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();
    });

    it('should retrieve feature flags', async () => {
      const mockFlags = {
        enableNewUI: true,
        enableBetaFeatures: false,
        allowedModels: ['gpt-4', 'gpt-3.5-turbo'],
      };

      mockGet.mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(mockGet).toHaveBeenCalledWith('feature_flags');
      expect(result).toEqual(mockFlags);
    });

    it('should handle boolean feature flags', async () => {
      const mockFlags = {
        feature1: true,
        feature2: false,
      };

      mockGet.mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });

    it('should handle string array feature flags', async () => {
      const mockFlags = {
        allowedRegions: ['us-east-1', 'eu-west-1'],
        enabledModels: ['model1', 'model2', 'model3'],
      };

      mockGet.mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });

    it('should handle mixed feature flags', async () => {
      const mockFlags = {
        booleanFlag: true,
        arrayFlag: ['value1', 'value2'],
        anotherBoolFlag: false,
      };

      mockGet.mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });

    it('should handle undefined feature flags', async () => {
      vi.mocked(mockClient.get!).mockResolvedValue(undefined);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toBeUndefined();
    });

    it('should handle empty feature flags object', async () => {
      vi.mocked(mockClient.get!).mockResolvedValue({});

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual({});
    });

    it('should propagate errors from the client', async () => {
      const error = new Error('API error');
      mockGet.mockRejectedValue(error);

      await expect(edgeConfig.getFeatureFlags()).rejects.toThrow('API error');
    });
  });

  describe('error handling', () => {
    it('should handle client creation errors', () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      const error = new Error('Invalid config URL');
      mockCreateClient.mockImplementation(() => {
        throw error;
      });

      edgeConfig = new EdgeConfig();

      expect(() => edgeConfig.client).toThrow('Invalid config URL');
    });

    it('should handle network timeouts', async () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();

      const timeoutError = new Error('Request timeout');
      vi.mocked(mockClient.get!).mockRejectedValue(timeoutError);

      await expect(edgeConfig.getFeatureFlags()).rejects.toThrow('Request timeout');
    });

    it('should handle malformed responses', async () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();

      const parseError = new Error('Invalid JSON response');
      vi.mocked(mockClient.getAll!).mockRejectedValue(parseError);

      await expect(edgeConfig.getAgentRestrictions()).rejects.toThrow('Invalid JSON response');
    });
  });

  describe('integration scenarios', () => {
    it('should work correctly when used multiple times', async () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();

      // First call
      const mockFlags1 = { feature1: true };
      mockGet.mockResolvedValueOnce(mockFlags1);
      const result1 = await edgeConfig.getFeatureFlags();
      expect(result1).toEqual(mockFlags1);

      // Second call
      const mockFlags2 = { feature2: false };
      mockGet.mockResolvedValueOnce(mockFlags2);
      const result2 = await edgeConfig.getFeatureFlags();
      expect(result2).toEqual(mockFlags2);

      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should handle concurrent requests', async () => {
      mockAppEnv.VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/test';
      edgeConfig = new EdgeConfig();

      mockGet.mockResolvedValue({ flag: true });
      mockGetAll.mockResolvedValue({
        assistant_blacklist: ['agent1'],
        assistant_whitelist: ['agent2'],
      });

      const [flags, restrictions] = await Promise.all([
        edgeConfig.getFeatureFlags(),
        edgeConfig.getAgentRestrictions(),
      ]);

      expect(flags).toEqual({ flag: true });
      expect(restrictions).toEqual({
        blacklist: ['agent1'],
        whitelist: ['agent2'],
      });
    });
  });
});
