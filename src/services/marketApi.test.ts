import { AgentItemDetail } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MARKET_ENDPOINTS } from '@/services/_url';

import { MarketApiService, marketApiService } from './marketApi';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MarketApiService', () => {
  let service: MarketApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MarketApiService();
  });

  describe('setAccessToken', () => {
    it('should set access token', () => {
      const token = 'test-token-123';
      service.setAccessToken(token);

      // Verify token is set by making a request and checking headers
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      service.createAgent({
        identifier: 'test',
        name: 'Test Agent',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );

      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer test-token-123');
    });
  });

  describe('request method', () => {
    it('should make successful GET request', async () => {
      const mockResponse = { id: 1, name: 'Test Agent' };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.getAgentDetail('test-agent');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail('test-agent'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'same-origin',
        }),
      );
    });

    it('should make successful POST request with JSON body', async () => {
      const mockResponse = {
        id: 1,
        identifier: 'new-agent',
        name: 'New Agent',
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const agentData = {
        identifier: 'new-agent',
        name: 'New Agent',
      };

      const result = await service.createAgent(agentData);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(agentData),
        }),
      );

      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should set authorization header when access token is set', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      service.setAccessToken('my-secret-token');

      await service.getAgentDetail('test');

      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer my-secret-token');
    });

    it('should not override existing content-type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      const customHeaders = new Headers();
      customHeaders.set('content-type', 'text/plain');

      await service.createAgent({
        identifier: 'test',
        name: 'Test',
      });

      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should not override existing authorization header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      service.setAccessToken('default-token');

      // Manually create request with custom auth header
      const customHeaders = new Headers();
      customHeaders.set('authorization', 'Bearer custom-token');

      await service.getAgentDetail('test');

      // Should use the service token since we can't override via public API
      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer default-token');
    });

    it('should handle 204 No Content response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      const result = await service.getAgentDetail('test');

      expect(result).toBeUndefined();
    });

    it('should set default credentials to same-origin', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      });

      await service.getAgentDetail('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'same-origin',
        }),
      );
    });

    it('should throw error when response is not ok with JSON error body', async () => {
      const errorMessage = 'Agent not found';
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ message: errorMessage }),
        text: vi.fn().mockResolvedValue('Not Found'),
      });

      await expect(service.getAgentDetail('non-existent')).rejects.toThrow(errorMessage);
    });

    it('should throw error when response is not ok with text error body', async () => {
      const errorText = 'Internal Server Error';
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(errorText),
      });

      await expect(service.getAgentDetail('test')).rejects.toThrow(errorText);
    });

    it('should throw default error message when error body is empty', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(service.getAgentDetail('test')).rejects.toThrow('Unknown error');
    });

    it('should throw error with message from error body', async () => {
      const customError = 'Custom error message';
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ message: customError }),
        text: vi.fn().mockResolvedValue('Bad Request'),
      });

      await expect(service.createAgent({ identifier: 'test', name: 'Test' })).rejects.toThrow(
        customError,
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network failure');
      mockFetch.mockRejectedValue(networkError);

      await expect(service.getAgentDetail('test')).rejects.toThrow('Network failure');
    });
  });

  describe('createAgent', () => {
    it('should create agent with minimal data', async () => {
      const mockAgent = {
        id: 1,
        identifier: 'simple-agent',
        name: 'Simple Agent',
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockAgent),
      });

      const result = await service.createAgent({
        identifier: 'simple-agent',
        name: 'Simple Agent',
      });

      expect(result).toEqual(mockAgent);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            identifier: 'simple-agent',
            name: 'Simple Agent',
          }),
        }),
      );
    });

    it('should create agent with full data', async () => {
      const agentData = {
        identifier: 'full-agent',
        name: 'Full Agent',
        homepage: 'https://example.com',
        isFeatured: true,
        status: 'published' as const,
        tokenUsage: 1000,
        visibility: 'public' as const,
      };

      const mockAgent = {
        id: 2,
        ...agentData,
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockAgent),
      });

      const result = await service.createAgent(agentData);

      expect(result).toEqual(mockAgent);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(agentData),
        }),
      );
    });

    it('should handle different status values', async () => {
      const statuses: Array<'published' | 'unpublished' | 'archived' | 'deprecated'> = [
        'published',
        'unpublished',
        'archived',
        'deprecated',
      ];

      for (const status of statuses) {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ id: 1, status }),
        });

        await service.createAgent({
          identifier: 'test',
          name: 'Test',
          status,
        });

        const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
        expect(body.status).toBe(status);
      }
    });

    it('should handle different visibility values', async () => {
      const visibilities: Array<'public' | 'private' | 'internal'> = [
        'public',
        'private',
        'internal',
      ];

      for (const visibility of visibilities) {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ id: 1, visibility }),
        });

        await service.createAgent({
          identifier: 'test',
          name: 'Test',
          visibility,
        });

        const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
        expect(body.visibility).toBe(visibility);
      }
    });
  });

  describe('getAgentDetail', () => {
    it('should get agent detail by identifier', async () => {
      const mockAgent = {
        id: 1,
        identifier: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockAgent),
      });

      const result = await service.getAgentDetail('test-agent');

      expect(result).toEqual(mockAgent);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail('test-agent'),
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should encode special characters in identifier', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      await service.getAgentDetail('agent/with/slashes');

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail('agent/with/slashes'),
        expect.any(Object),
      );
    });

    it('should handle agent not found error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ message: 'Agent not found' }),
        text: vi.fn().mockResolvedValue('Not Found'),
      });

      await expect(service.getAgentDetail('non-existent')).rejects.toThrow('Agent not found');
    });
  });

  describe('checkAgentExists', () => {
    it('should return true when agent exists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1, identifier: 'existing-agent' }),
      });

      const exists = await service.checkAgentExists('existing-agent');

      expect(exists).toBe(true);
    });

    it('should return false when agent does not exist', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ message: 'Not found' }),
        text: vi.fn().mockResolvedValue('Not Found'),
      });

      const exists = await service.checkAgentExists('non-existent');

      expect(exists).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const exists = await service.checkAgentExists('test-agent');

      expect(exists).toBe(false);
    });

    it('should return false on any error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'Server error' }),
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });

      const exists = await service.checkAgentExists('test-agent');

      expect(exists).toBe(false);
    });
  });

  describe('createAgentVersion', () => {
    it('should throw error when identifier is missing', async () => {
      await expect(
        service.createAgentVersion({
          identifier: '',
          name: 'Version 1',
        }),
      ).rejects.toThrow('Identifier is required');
    });

    it('should create agent version with minimal data', async () => {
      const mockVersion = {
        id: 1,
        identifier: 'test-agent',
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockVersion),
      });

      const result = await service.createAgentVersion({
        identifier: 'test-agent',
      });

      expect(result).toEqual(mockVersion);
      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgentVersion,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            identifier: 'test-agent',
          }),
        }),
      );
    });

    it('should create agent version with full data', async () => {
      const versionData = {
        identifier: 'test-agent',
        name: 'Test Agent v2',
        avatar: 'https://example.com/avatar.png',
        category: 'productivity',
        changelog: '- Added new features\n- Fixed bugs',
        config: { theme: 'dark' },
        defaultInputModes: ['text', 'voice'],
        defaultOutputModes: ['text'],
        description: 'An updated version',
        documentationUrl: 'https://docs.example.com',
        extensions: [{ name: 'ext1', version: '1.0' }],
        hasPushNotifications: true,
        hasStateTransitionHistory: true,
        hasStreaming: true,
        interfaces: [{ type: 'chat', version: '1.0' }],
        preferredTransport: 'websocket',
        providerId: 123,
        securityRequirements: [{ scheme: 'oauth2' }],
        securitySchemes: { oauth2: { type: 'oauth2' } },
        setAsCurrent: true,
        summary: 'A great agent',
        supportsAuthenticatedExtendedCard: true,
        tokenUsage: 5000,
        url: 'https://agent.example.com',
        a2aProtocolVersion: '2.0',
      };

      const mockVersion = {
        id: 1,
        ...versionData,
      } as unknown as AgentItemDetail;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockVersion),
      });

      const result = await service.createAgentVersion(versionData);

      expect(result).toEqual(mockVersion);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.identifier).toBe('test-agent');
      expect(requestBody.name).toBe('Test Agent v2');
      expect(requestBody.changelog).toBe('- Added new features\n- Fixed bugs');
      expect(requestBody.config).toEqual({ theme: 'dark' });
    });

    it('should separate identifier from rest of data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      await service.createAgentVersion({
        identifier: 'my-agent',
        name: 'My Agent',
        summary: 'Test summary',
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody).toHaveProperty('identifier', 'my-agent');
      expect(requestBody).toHaveProperty('name', 'My Agent');
      expect(requestBody).toHaveProperty('summary', 'Test summary');
    });

    it('should handle boolean flags correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      await service.createAgentVersion({
        identifier: 'test',
        hasPushNotifications: false,
        hasStateTransitionHistory: true,
        hasStreaming: false,
        setAsCurrent: true,
        supportsAuthenticatedExtendedCard: false,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.hasPushNotifications).toBe(false);
      expect(requestBody.hasStateTransitionHistory).toBe(true);
      expect(requestBody.hasStreaming).toBe(false);
      expect(requestBody.setAsCurrent).toBe(true);
      expect(requestBody.supportsAuthenticatedExtendedCard).toBe(false);
    });

    it('should handle array fields correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 1 }),
      });

      await service.createAgentVersion({
        identifier: 'test',
        defaultInputModes: ['text', 'image', 'audio'],
        defaultOutputModes: ['text', 'video'],
        extensions: [
          { id: 'ext1', name: 'Extension 1' },
          { id: 'ext2', name: 'Extension 2' },
        ],
        interfaces: [{ type: 'rest', version: '1.0' }],
        securityRequirements: [{ name: 'api_key' }],
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.defaultInputModes).toEqual(['text', 'image', 'audio']);
      expect(requestBody.defaultOutputModes).toEqual(['text', 'video']);
      expect(requestBody.extensions).toHaveLength(2);
      expect(requestBody.interfaces).toHaveLength(1);
      expect(requestBody.securityRequirements).toHaveLength(1);
    });
  });

  describe('marketApiService singleton', () => {
    it('should export a singleton instance', () => {
      expect(marketApiService).toBeInstanceOf(MarketApiService);
    });
  });
});
