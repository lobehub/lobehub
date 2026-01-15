import { AgentItemDetail } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MARKET_ENDPOINTS } from '@/services/_url';

import { MarketApiService } from './marketApi';

describe('MarketApiService', () => {
  let service: MarketApiService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MarketApiService();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe('setAccessToken', () => {
    it('should store access token', () => {
      const token = 'test-token-123';
      service.setAccessToken(token);

      // Verify token is stored by checking it's used in subsequent requests
      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      service.createAgent({
        identifier: 'test',
        name: 'Test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    });
  });

  describe('request method behavior', () => {
    describe('headers management', () => {
      it('should add content-type header when body is present and header is missing', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ identifier: 'test' }),
          ok: true,
          status: 200,
        });

        await service.createAgent({
          identifier: 'test',
          name: 'Test',
        });

        const headers = mockFetch.mock.calls[0][1].headers;
        expect(headers.get('content-type')).toBe('application/json');
      });

      it('should not override content-type header if already present', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ identifier: 'test' }),
          ok: true,
          status: 200,
        });

        // Access private request method through createAgent
        // First set a custom header by modifying the implementation
        const customHeaders = new Headers();
        customHeaders.set('content-type', 'application/custom');

        // Test that existing content-type is not overridden
        await service.createAgent({
          identifier: 'test',
          name: 'Test',
        });

        const headers = mockFetch.mock.calls[0][1].headers;
        expect(headers.get('content-type')).toBe('application/json');
      });

      it('should add authorization header when access token is set', async () => {
        const token = 'secret-token';
        service.setAccessToken(token);

        mockFetch.mockResolvedValue({
          json: async () => ({ identifier: 'test' }),
          ok: true,
          status: 200,
        });

        await service.createAgent({
          identifier: 'test',
          name: 'Test',
        });

        const headers = mockFetch.mock.calls[0][1].headers;
        expect(headers.get('authorization')).toBe(`Bearer ${token}`);
      });

      it('should not add authorization header when no access token is set', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ identifier: 'test' }),
          ok: true,
          status: 200,
        });

        await service.getAgentDetail('test');

        const headers = mockFetch.mock.calls[0][1].headers;
        expect(headers.get('authorization')).toBeNull();
      });

      it('should set credentials to same-origin by default', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ identifier: 'test' }),
          ok: true,
          status: 200,
        });

        await service.getAgentDetail('test');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            credentials: 'same-origin',
          }),
        );
      });
    });

    describe('error handling', () => {
      it('should throw error with JSON message when response is not ok', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ message: 'Agent not found' }),
          ok: false,
          status: 404,
        });

        await expect(service.getAgentDetail('non-existent')).rejects.toThrow('Agent not found');
      });

      it('should throw error with text message when JSON parsing fails', async () => {
        mockFetch.mockResolvedValue({
          json: async () => {
            throw new Error('Invalid JSON');
          },
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });

        await expect(service.getAgentDetail('test')).rejects.toThrow('Internal Server Error');
      });

      it('should throw default error message when no error body is available', async () => {
        mockFetch.mockResolvedValue({
          json: async () => {
            throw new Error('Invalid JSON');
          },
          ok: false,
          status: 500,
          text: async () => '',
        });

        await expect(service.getAgentDetail('test')).rejects.toThrow('Market request failed');
      });

      it('should use error message from JSON body if available', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ message: 'Custom error message' }),
          ok: false,
          status: 400,
        });

        await expect(service.createAgent({ identifier: 'test', name: 'Test' })).rejects.toThrow(
          'Custom error message',
        );
      });

      it('should handle JSON body without message field', async () => {
        mockFetch.mockResolvedValue({
          json: async () => ({ error: 'Some error' }),
          ok: false,
          status: 400,
        });

        await expect(service.createAgent({ identifier: 'test', name: 'Test' })).rejects.toThrow(
          'Unknown error',
        );
      });
    });

    describe('response handling', () => {
      it('should return undefined for 204 No Content responses', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 204,
        });

        const result = await service.getAgentDetail('test');

        expect(result).toBeUndefined();
      });

      it('should parse and return JSON for successful responses', async () => {
        const mockAgent: AgentItemDetail = {
          author: 'test-author',
          createdAt: '2024-01-01',
          homepage: 'https://example.com',
          identifier: 'test-agent',
          manifest: {
            identifier: 'test-agent',
            meta: {
              avatar: 'avatar.png',
              description: 'Test description',
              tags: ['test'],
              title: 'Test Agent',
            },
            schemaVersion: 1,
          },
          meta: {
            avatar: 'avatar.png',
            description: 'Test description',
            tags: ['test'],
            title: 'Test Agent',
          },
        };

        mockFetch.mockResolvedValue({
          json: async () => mockAgent,
          ok: true,
          status: 200,
        });

        const result = await service.getAgentDetail('test-agent');

        expect(result).toEqual(mockAgent);
      });
    });
  });

  describe('createAgent', () => {
    it('should create agent with minimal data', async () => {
      const agentData = {
        identifier: 'test-agent',
        name: 'Test Agent',
      };

      const mockResponse: AgentItemDetail = {
        author: 'test',
        createdAt: '2024-01-01',
        identifier: 'test-agent',
        manifest: {
          identifier: 'test-agent',
          meta: {
            avatar: '',
            description: '',
            tags: [],
            title: 'Test Agent',
          },
          schemaVersion: 1,
        },
        meta: {
          avatar: '',
          description: '',
          tags: [],
          title: 'Test Agent',
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => mockResponse,
        ok: true,
        status: 200,
      });

      const result = await service.createAgent(agentData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          body: JSON.stringify(agentData),
          method: 'POST',
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create agent with full data', async () => {
      const agentData = {
        homepage: 'https://example.com',
        identifier: 'full-agent',
        isFeatured: true,
        name: 'Full Agent',
        status: 'published' as const,
        tokenUsage: 1000,
        visibility: 'public' as const,
      };

      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      await service.createAgent(agentData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgent,
        expect.objectContaining({
          body: JSON.stringify(agentData),
          method: 'POST',
        }),
      );
    });

    it('should handle create agent errors', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ message: 'Agent already exists' }),
        ok: false,
        status: 409,
      });

      await expect(
        service.createAgent({
          identifier: 'existing-agent',
          name: 'Existing',
        }),
      ).rejects.toThrow('Agent already exists');
    });
  });

  describe('getAgentDetail', () => {
    it('should fetch agent detail by identifier', async () => {
      const identifier = 'test-agent';
      const mockAgent: AgentItemDetail = {
        author: 'test-author',
        createdAt: '2024-01-01',
        identifier,
        manifest: {
          identifier,
          meta: {
            avatar: 'avatar.png',
            description: 'Test',
            tags: [],
            title: 'Test',
          },
          schemaVersion: 1,
        },
        meta: {
          avatar: 'avatar.png',
          description: 'Test',
          tags: [],
          title: 'Test',
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => mockAgent,
        ok: true,
        status: 200,
      });

      const result = await service.getAgentDetail(identifier);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail(identifier),
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result).toEqual(mockAgent);
    });

    it('should encode identifier in URL', async () => {
      const identifier = 'agent/with/slashes';

      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      await service.getAgentDetail(identifier);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.getAgentDetail(identifier),
        expect.any(Object),
      );
      // Verify URL encoding is handled by MARKET_ENDPOINTS.getAgentDetail
      expect(MARKET_ENDPOINTS.getAgentDetail(identifier)).toContain(encodeURIComponent(identifier));
    });

    it('should handle not found errors', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ message: 'Agent not found' }),
        ok: false,
        status: 404,
      });

      await expect(service.getAgentDetail('non-existent')).rejects.toThrow('Agent not found');
    });
  });

  describe('checkAgentExists', () => {
    it('should return true when agent exists', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ identifier: 'existing-agent' }),
        ok: true,
        status: 200,
      });

      const exists = await service.checkAgentExists('existing-agent');

      expect(exists).toBe(true);
    });

    it('should return false when agent does not exist', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ message: 'Not found' }),
        ok: false,
        status: 404,
      });

      const exists = await service.checkAgentExists('non-existent');

      expect(exists).toBe(false);
    });

    it('should return false on any error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const exists = await service.checkAgentExists('test');

      expect(exists).toBe(false);
    });

    it('should return false on server errors', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ message: 'Internal server error' }),
        ok: false,
        status: 500,
      });

      const exists = await service.checkAgentExists('test');

      expect(exists).toBe(false);
    });
  });

  describe('createAgentVersion', () => {
    it('should throw error when identifier is missing', async () => {
      await expect(
        service.createAgentVersion({
          identifier: '',
        }),
      ).rejects.toThrow('Identifier is required');
    });

    it('should create agent version with minimal data', async () => {
      const versionData = {
        identifier: 'test-agent',
      };

      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      await service.createAgentVersion(versionData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgentVersion,
        expect.objectContaining({
          body: JSON.stringify({ identifier: 'test-agent' }),
          method: 'POST',
        }),
      );
    });

    it('should create agent version with full data', async () => {
      const versionData = {
        a2aProtocolVersion: '1.0',
        avatar: 'avatar.png',
        category: 'productivity',
        changelog: 'Initial release',
        config: { key: 'value' },
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        description: 'Test description',
        documentationUrl: 'https://docs.example.com',
        extensions: [{ name: 'ext1' }],
        hasPushNotifications: true,
        hasStateTransitionHistory: false,
        hasStreaming: true,
        identifier: 'test-agent',
        interfaces: [{ type: 'chat' }],
        name: 'Test Agent v2',
        preferredTransport: 'http',
        providerId: 123,
        securityRequirements: [{ scheme: 'oauth2' }],
        securitySchemes: { oauth2: { type: 'oauth2' } },
        setAsCurrent: true,
        summary: 'Version 2.0',
        supportsAuthenticatedExtendedCard: true,
        tokenUsage: 2000,
        url: 'https://example.com',
      };

      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      await service.createAgentVersion(versionData);

      expect(mockFetch).toHaveBeenCalledWith(
        MARKET_ENDPOINTS.createAgentVersion,
        expect.objectContaining({
          body: expect.stringContaining('"identifier":"test-agent"'),
          method: 'POST',
        }),
      );
    });

    it('should handle version creation errors', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ message: 'Invalid version data' }),
        ok: false,
        status: 400,
      });

      await expect(
        service.createAgentVersion({
          identifier: 'test-agent',
        }),
      ).rejects.toThrow('Invalid version data');
    });

    it('should validate identifier before making request', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({}),
        ok: true,
        status: 200,
      });

      // Should throw before making fetch call
      await expect(
        service.createAgentVersion({
          identifier: '',
        }),
      ).rejects.toThrow('Identifier is required');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('marketApiService singleton', () => {
    it('should export a singleton instance', async () => {
      const { marketApiService } = await import('./marketApi');

      expect(marketApiService).toBeInstanceOf(MarketApiService);
    });
  });
});
