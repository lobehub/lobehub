import { EdgeConfigClient, createClient } from '@vercel/edge-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appEnv } from '@/envs/app';

import { EdgeConfig } from './index';

// Mock the dependencies
vi.mock('@vercel/edge-config');

vi.mock('@/envs/app', () => ({
  appEnv: {
    VERCEL_EDGE_CONFIG: '',
  },
}));

describe('EdgeConfig', () => {
  let edgeConfig: EdgeConfig;
  let mockClient: Partial<EdgeConfigClient>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup mock client
    mockClient = {
      get: vi.fn(),
      getAll: vi.fn(),
    };

    edgeConfig = new EdgeConfig();
  });

  describe('isEnabled', () => {
    it('should return true when VERCEL_EDGE_CONFIG is set', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/example';

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(true);
    });

    it('should return false when VERCEL_EDGE_CONFIG is not set', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = '';

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });

    it('should return false when VERCEL_EDGE_CONFIG is undefined', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = undefined;

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });

    it('should return false when VERCEL_EDGE_CONFIG is null', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = null;

      const result = EdgeConfig.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('client getter', () => {
    it('should return a client when VERCEL_EDGE_CONFIG is set', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/example';

      vi.mocked(createClient).mockReturnValue(mockClient as EdgeConfigClient);

      const client = edgeConfig.client;

      expect(createClient).toHaveBeenCalledWith('https://edge-config.vercel.com/example');
      expect(client).toBe(mockClient);
    });

    it('should throw error when VERCEL_EDGE_CONFIG is not set', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = '';

      expect(() => edgeConfig.client).toThrow('VERCEL_EDGE_CONFIG is not set');
    });

    it('should throw error when VERCEL_EDGE_CONFIG is undefined', () => {
      (appEnv as any).VERCEL_EDGE_CONFIG = undefined;

      expect(() => edgeConfig.client).toThrow('VERCEL_EDGE_CONFIG is not set');
    });
  });

  describe('getAgentRestrictions', () => {
    beforeEach(() => {
      (appEnv as any).VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/example';
      vi.mocked(createClient).mockReturnValue(mockClient as EdgeConfigClient);
    });

    it('should return blacklist and whitelist when both are configured', async () => {
      const mockData = {
        assistant_blacklist: ['assistant1', 'assistant2'],
        assistant_whitelist: ['assistant3', 'assistant4'],
      };

      (mockClient.getAll as any).mockResolvedValue(mockData);

      const result = await edgeConfig.getAgentRestrictions();

      expect(mockClient.getAll).toHaveBeenCalledWith(['assistant_blacklist', 'assistant_whitelist']);
      expect(result).toEqual({
        blacklist: ['assistant1', 'assistant2'],
        whitelist: ['assistant3', 'assistant4'],
      });
    });

    it('should return undefined values when restrictions are not configured', async () => {
      const mockData = {
        assistant_blacklist: undefined,
        assistant_whitelist: undefined,
      };

      (mockClient.getAll as any).mockResolvedValue(mockData);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: undefined,
        whitelist: undefined,
      });
    });

    it('should return only blacklist when whitelist is not configured', async () => {
      const mockData = {
        assistant_blacklist: ['assistant1'],
        assistant_whitelist: undefined,
      };

      (mockClient.getAll as any).mockResolvedValue(mockData);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: ['assistant1'],
        whitelist: undefined,
      });
    });

    it('should return only whitelist when blacklist is not configured', async () => {
      const mockData = {
        assistant_blacklist: undefined,
        assistant_whitelist: ['assistant2'],
      };

      (mockClient.getAll as any).mockResolvedValue(mockData);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: undefined,
        whitelist: ['assistant2'],
      });
    });

    it('should handle empty arrays', async () => {
      const mockData = {
        assistant_blacklist: [],
        assistant_whitelist: [],
      };

      (mockClient.getAll as any).mockResolvedValue(mockData);

      const result = await edgeConfig.getAgentRestrictions();

      expect(result).toEqual({
        blacklist: [],
        whitelist: [],
      });
    });
  });

  describe('getFeatureFlags', () => {
    beforeEach(() => {
      (appEnv as any).VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/example';
      vi.mocked(createClient).mockReturnValue(mockClient as EdgeConfigClient);
    });

    it('should return feature flags when configured', async () => {
      const mockFlags = {
        enableNewFeature: true,
        betaUsers: ['user1', 'user2'],
        maxItems: 100,
      };

      (mockClient.get as any).mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(mockClient.get).toHaveBeenCalledWith('feature_flags');
      expect(result).toEqual(mockFlags);
    });

    it('should return undefined when feature flags are not configured', async () => {
      (mockClient.get as any).mockResolvedValue(undefined);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toBeUndefined();
    });

    it('should return empty object when feature flags is an empty object', async () => {
      (mockClient.get as any).mockResolvedValue({});

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual({});
    });

    it('should handle feature flags with boolean values', async () => {
      const mockFlags = {
        feature1: true,
        feature2: false,
      };

      (mockClient.get as any).mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });

    it('should handle feature flags with string array values', async () => {
      const mockFlags = {
        allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
      };

      (mockClient.get as any).mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });

    it('should handle mixed feature flags with boolean and string array values', async () => {
      const mockFlags = {
        enableFeatureX: true,
        disableFeatureY: false,
        betaRegions: ['us-east-1', 'eu-west-1'],
      };

      (mockClient.get as any).mockResolvedValue(mockFlags);

      const result = await edgeConfig.getFeatureFlags();

      expect(result).toEqual(mockFlags);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      (appEnv as any).VERCEL_EDGE_CONFIG = 'https://edge-config.vercel.com/example';
      vi.mocked(createClient).mockReturnValue(mockClient as EdgeConfigClient);
    });

    it('should propagate errors from getAgentRestrictions', async () => {
      const error = new Error('Network error');
      (mockClient.getAll as any).mockRejectedValue(error);

      await expect(edgeConfig.getAgentRestrictions()).rejects.toThrow('Network error');
    });

    it('should propagate errors from getFeatureFlags', async () => {
      const error = new Error('API error');
      (mockClient.get as any).mockRejectedValue(error);

      await expect(edgeConfig.getFeatureFlags()).rejects.toThrow('API error');
    });
  });
});
