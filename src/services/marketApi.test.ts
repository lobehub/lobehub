import { AgentItemDetail } from '@lobehub/market-sdk';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketApiService } from './marketApi';

vi.stubGlobal('fetch', vi.fn());

describe('MarketApiService', () => {
  let service: MarketApiService;

  beforeEach(() => {
    service = new MarketApiService();
    (fetch as Mock).mockClear();
  });

  describe('request', () => {
    it('should make request with default headers', async () => {
      const mockData = { id: '1', name: 'Test Agent' };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      const result = await service.request('/test-endpoint', { method: 'GET' });

      expect(fetch).toHaveBeenCalledWith(
        '/test-endpoint',
        expect.objectContaining({
          method: 'GET',
          credentials: 'same-origin',
          headers: expect.any(Headers),
        }),
      );
      expect(result).toEqual(mockData);
    });

    it('should add Content-Type header for POST requests with body', async () => {
      const mockData = { success: true };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      await service.request('/test-endpoint', {
        body: JSON.stringify({ test: 'data' }),
        method: 'POST',
      });

      const callArgs = (fetch as Mock).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should not override existing Content-Type header', async () => {
      const mockData = { success: true };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      await service.request('/test-endpoint', {
        body: JSON.stringify({ test: 'data' }),
        headers: { 'content-type': 'text/plain' },
        method: 'POST',
      });

      const callArgs = (fetch as Mock).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get('content-type')).toBe('text/plain');
    });

    it('should add Authorization header when access token is set', async () => {
      service.setAccessToken('test-token');
      const mockData = { id: '1' };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      await service.request('/test-endpoint', { method: 'GET' });

      const callArgs = (fetch as Mock).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer test-token');
    });

    it('should not override existing Authorization header', async () => {
      service.setAccessToken('test-token');
      const mockData = { id: '1' };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      await service.request('/test-endpoint', {
        headers: { authorization: 'Bearer custom-token' },
        method: 'GET',
      });

      const callArgs = (fetch as Mock).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer custom-token');
    });

    it('should return undefined for 204 status', async () => {
      (fetch as Mock).mockResolvedValueOnce(new Response(null, { status: 204 }));

      // @ts-ignore - accessing private method for testing
      const result = await service.request('/test-endpoint', { method: 'DELETE' });

      expect(result).toBeUndefined();
    });

    it('should throw error with message from JSON response on failure', async () => {
      const errorMessage = 'Agent not found';
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: errorMessage }), { status: 404 }),
      );

      // @ts-ignore - accessing private method for testing
      await expect(service.request('/test-endpoint', { method: 'GET' })).rejects.toThrow(
        errorMessage,
      );
    });

    it('should throw error with text response when JSON parsing fails', async () => {
      const errorText = 'Internal Server Error';
      // Mock a response that will fail JSON parsing but succeed with text
      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValueOnce(new Error('JSON parse error')),
        text: vi.fn().mockResolvedValueOnce(errorText),
      };
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      // @ts-ignore - accessing private method for testing
      await expect(service.request('/test-endpoint', { method: 'GET' })).rejects.toThrow(errorText);
      expect(mockResponse.json).toHaveBeenCalled();
      expect(mockResponse.text).toHaveBeenCalled();
    });

    it('should throw default error message when response has no body', async () => {
      // Mock a response that fails both JSON and text parsing
      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValueOnce(new Error('JSON parse error')),
        text: vi.fn().mockResolvedValueOnce(''),
      };
      (fetch as Mock).mockResolvedValueOnce(mockResponse);

      // @ts-ignore - accessing private method for testing
      await expect(service.request('/test-endpoint', { method: 'GET' })).rejects.toThrow(
        'Market request failed',
      );
    });
  });

  describe('setAccessToken', () => {
    it('should set access token', async () => {
      service.setAccessToken('new-token');

      const mockData = { id: '1' };
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

      // @ts-ignore - accessing private method for testing
      await service.request('/test-endpoint', { method: 'GET' });

      const callArgs = (fetch as Mock).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get('authorization')).toBe('Bearer new-token');
    });
  });

  describe('createAgent', () => {
    it('should create agent successfully', async () => {
      const agentData = {
        identifier: 'test-agent',
        name: 'Test Agent',
      };
      const mockResponse = {
        ...agentData,
        id: '1',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.createAgent(agentData);

      expect(fetch).toHaveBeenCalledWith(
        '/market/agent/create',
        expect.objectContaining({
          body: JSON.stringify(agentData),
          method: 'POST',
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create agent with all optional fields', async () => {
      const agentData = {
        homepage: 'https://example.com',
        identifier: 'test-agent',
        isFeatured: true,
        name: 'Test Agent',
        status: 'published' as const,
        tokenUsage: 1000,
        visibility: 'public' as const,
      };
      const mockResponse = {
        ...agentData,
        id: '1',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.createAgent(agentData);

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getAgentDetail', () => {
    it('should get agent detail successfully', async () => {
      const identifier = 'test-agent';
      const mockResponse = {
        id: '1',
        identifier,
        name: 'Test Agent',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.getAgentDetail(identifier);

      expect(fetch).toHaveBeenCalledWith(
        `/market/agent/${encodeURIComponent(identifier)}`,
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle special characters in identifier', async () => {
      const identifier = 'test/agent@v1';
      const mockResponse = {
        id: '1',
        identifier,
        name: 'Test Agent',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      await service.getAgentDetail(identifier);

      expect(fetch).toHaveBeenCalledWith(
        `/market/agent/${encodeURIComponent(identifier)}`,
        expect.any(Object),
      );
    });
  });

  describe('checkAgentExists', () => {
    it('should return true when agent exists', async () => {
      const mockResponse = {
        id: '1',
        identifier: 'test-agent',
        name: 'Test Agent',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.checkAgentExists('test-agent');

      expect(result).toBe(true);
    });

    it('should return false when agent does not exist', async () => {
      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }),
      );

      const result = await service.checkAgentExists('non-existent-agent');

      expect(result).toBe(false);
    });

    it('should return false on any error', async () => {
      (fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await service.checkAgentExists('test-agent');

      expect(result).toBe(false);
    });
  });

  describe('createAgentVersion', () => {
    it('should create agent version successfully', async () => {
      const versionData = {
        identifier: 'test-agent',
        name: 'Test Agent',
        changelog: 'Initial version',
      };
      const mockResponse = {
        ...versionData,
        id: '1',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.createAgentVersion(versionData);

      expect(fetch).toHaveBeenCalledWith(
        '/market/agent/versions/create',
        expect.objectContaining({
          body: JSON.stringify(versionData),
          method: 'POST',
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when identifier is missing', async () => {
      const versionData = {
        identifier: '',
        name: 'Test Agent',
      };

      await expect(service.createAgentVersion(versionData)).rejects.toThrow(
        'Identifier is required',
      );
    });

    it('should create agent version with all optional fields', async () => {
      const versionData = {
        a2aProtocolVersion: '1.0',
        avatar: 'https://example.com/avatar.png',
        category: 'productivity',
        changelog: 'Bug fixes',
        config: { setting1: 'value1' },
        defaultInputModes: ['text', 'voice'],
        defaultOutputModes: ['text'],
        description: 'Test agent description',
        documentationUrl: 'https://docs.example.com',
        extensions: [{ name: 'ext1' }],
        hasPushNotifications: true,
        hasStateTransitionHistory: false,
        hasStreaming: true,
        identifier: 'test-agent',
        interfaces: [{ type: 'chat' }],
        name: 'Test Agent',
        preferredTransport: 'http',
        providerId: 123,
        securityRequirements: [{ oauth2: ['read', 'write'] }],
        securitySchemes: { oauth2: {} },
        setAsCurrent: true,
        summary: 'Short summary',
        supportsAuthenticatedExtendedCard: true,
        tokenUsage: 5000,
        url: 'https://example.com',
      };
      const mockResponse = {
        ...versionData,
        id: '1',
      } as unknown as AgentItemDetail;

      (fetch as Mock).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await service.createAgentVersion(versionData);

      expect(result).toEqual(mockResponse);
    });
  });

  describe('marketApiService singleton', () => {
    it('should export a singleton instance', async () => {
      // Import the singleton
      const { marketApiService } = await import('./marketApi');

      expect(marketApiService).toBeInstanceOf(MarketApiService);
    });
  });
});
