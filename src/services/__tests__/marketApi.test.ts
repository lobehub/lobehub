import { AgentItemDetail } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MARKET_ENDPOINTS } from '@/services/_url';

import { MarketApiService } from '../marketApi';

// Mock fetch globally
global.fetch = vi.fn();

describe('MarketApiService', () => {
  let service: MarketApiService;
  const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new MarketApiService();
    vi.clearAllMocks();
  });

  describe('setAccessToken', () => {
    it('should set access token', () => {
      const token = 'test-token-123';
      service.setAccessToken(token);

      // Verify token is set by checking if it's included in request headers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ test: 'data' }),
      } as Response);

      service.createAgent({ identifier: 'test', name: 'Test Agent' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    });
  });

  describe('request method', () => {
    it('should set default content-type header when body is present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'success' }),
      } as Response);

      await service.createAgent({ identifier: 'test', name: 'Test' });

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should include authorization header when access token is set', async () => {
      const token = 'my-access-token';
      service.setAccessToken(token);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'success' }),
      } as Response);

      await service.getAgentDetail('test-agent');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    });

    it('should not override existing authorization header', async () => {
      service.setAccessToken('default-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'success' }),
      } as Response);

      const customHeaders = new Headers();
      customHeaders.set('authorization', 'Bearer custom-token');

      await service['request']('/test', {
        headers: customHeaders,
      });

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer custom-token');
    });

    it('should set default credentials to same-origin', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'success' }),
      } as Response);

      await service.getAgentDetail('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'same-origin',
        }),
      );
    });

    it('should handle successful JSON response', async () => {
      const mockData = { id: 1, name: 'Test Agent' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await service.getAgentDetail('test');

      expect(result).toEqual(mockData);
    });

    it('should handle 204 No Content response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      } as Response);

      const result = await service['request']('/test', { method: 'DELETE' });

      expect(result).toBeUndefined();
    });

    it('should throw error when response is not ok with JSON error body', async () => {
      const errorMessage = 'Agent not found';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: errorMessage }),
      } as Response);

      await expect(service.getAgentDetail('non-existent')).rejects.toThrow(errorMessage);
    });

    it('should throw error when response is not ok with text error body', async () => {
      const errorMessage = 'Server Error';
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => errorMessage,
      } as unknown as Response);

      await expect(service.getAgentDetail('test')).rejects.toThrow(errorMessage);
    });

    it('should throw default error message when no error body available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => '',
      } as unknown as Response);

      await expect(service.getAgentDetail('test')).rejects.toThrow('Market request failed');
    });
  });

  describe('createAgent', () => {
    it('should create agent with all fields', async () => {
      const agentData = {
        identifier: 'test-agent',
        name: 'Test Agent',
        homepage: 'https://example.com',
        isFeatured: true,
        status: 'published' as const,
        tokenUsage: 100,
        visibility: 'public' as const,
      };

      const mockResponse = {
        ...agentData,
        id: 123,
        createdAt: new Date().toISOString(),
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.createAgent(agentData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(agentData),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create agent with minimal required fields', async () => {
      const agentData = {
        identifier: 'minimal-agent',
        name: 'Minimal Agent',
      };

      const mockResponse = {
        ...agentData,
        id: 456,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.createAgent(agentData);

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getAgentDetail', () => {
    it('should get agent detail by identifier', async () => {
      const identifier = 'my-agent';
      const mockResponse = {
        identifier,
        name: 'My Agent',
        id: 789,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.getAgentDetail(identifier);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail(identifier),
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should properly encode identifier with special characters', async () => {
      const identifier = 'agent/with/slashes';
      const mockResponse = {
        identifier,
        name: 'Agent',
        id: 999,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await service.getAgentDetail(identifier);

      expect(mockFetch).toHaveBeenCalledWith(
        `/market/agent/${encodeURIComponent(identifier)}`,
        expect.any(Object),
      );
    });
  });

  describe('checkAgentExists', () => {
    it('should return true when agent exists', async () => {
      const mockResponse = {
        identifier: 'existing-agent',
        name: 'Existing',
        id: 111,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.checkAgentExists('existing-agent');

      expect(result).toBe(true);
    });

    it('should return false when agent does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Not found' }),
      } as Response);

      const result = await service.checkAgentExists('non-existent-agent');

      expect(result).toBe(false);
    });

    it('should return false when request fails for any reason', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.checkAgentExists('agent');

      expect(result).toBe(false);
    });
  });

  describe('createAgentVersion', () => {
    it('should create agent version with all fields', async () => {
      const versionData = {
        identifier: 'test-agent',
        name: 'Test Agent v2',
        a2aProtocolVersion: '1.0.0',
        avatar: 'https://example.com/avatar.png',
        category: 'productivity',
        changelog: 'Fixed bugs',
        config: { option1: 'value1' },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        description: 'Test description',
        documentationUrl: 'https://docs.example.com',
        extensions: [{ name: 'ext1' }],
        hasPushNotifications: true,
        hasStateTransitionHistory: true,
        hasStreaming: true,
        interfaces: [{ type: 'chat' }],
        preferredTransport: 'http',
        providerId: 123,
        securityRequirements: [{ apiKey: [] }],
        securitySchemes: { apiKey: { type: 'apiKey' } },
        setAsCurrent: true,
        summary: 'Short summary',
        supportsAuthenticatedExtendedCard: true,
        tokenUsage: 200,
        url: 'https://agent.example.com',
      };

      const mockResponse = {
        id: 777,
        identifier: versionData.identifier,
        name: versionData.name,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.createAgentVersion(versionData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgentVersion,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(versionData),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create agent version with minimal required fields', async () => {
      const versionData = {
        identifier: 'minimal-agent',
      };

      const mockResponse = {
        id: 888,
        identifier: versionData.identifier,
      } as Partial<AgentItemDetail> as AgentItemDetail;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.createAgentVersion(versionData);

      expect(result).toEqual(mockResponse);
    });

    it('should throw error when identifier is empty', async () => {
      const versionData = {
        identifier: '',
        name: 'Test',
      };

      await expect(service.createAgentVersion(versionData)).rejects.toThrow(
        'Identifier is required',
      );
    });

    it('should throw error when identifier is not provided', async () => {
      const versionData = {
        name: 'Test',
      } as any;

      await expect(service.createAgentVersion(versionData)).rejects.toThrow(
        'Identifier is required',
      );
    });
  });
});
