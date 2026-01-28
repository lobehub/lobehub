import { OpenAIPluginManifest } from '@lobechat/types';
import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertOpenAIManifestToLobeManifest, getToolManifest } from './toolManifest';

// Mock the API_ENDPOINTS import
vi.mock('@/services/_url', () => ({
  API_ENDPOINTS: {
    proxy: '/webapi/proxy',
  },
}));

describe('toolManifest', () => {
  describe('convertOpenAIManifestToLobeManifest', () => {
    it('should convert basic OpenAI manifest to Lobe manifest', () => {
      const openAIManifest: OpenAIPluginManifest = {
        schema_version: 'v1',
        name_for_model: 'test_plugin',
        name_for_human: 'Test Plugin',
        description_for_model: 'A test plugin for model',
        description_for_human: 'A test plugin for humans',
        auth: {
          type: 'none',
          instructions: '',
        },
        api: {
          type: 'openapi',
          url: 'https://example.com/openapi.json',
        },
        logo_url: 'https://example.com/logo.png',
        contact_email: 'test@example.com',
        legal_info_url: 'https://example.com/legal',
      };

      const result = convertOpenAIManifestToLobeManifest(openAIManifest);

      expect(result).toEqual({
        api: [],
        homepage: 'https://example.com/legal',
        identifier: 'test_plugin',
        meta: {
          avatar: 'https://example.com/logo.png',
          description: 'A test plugin for humans',
          title: 'Test Plugin',
        },
        openapi: 'https://example.com/openapi.json',
        systemRole: 'A test plugin for model',
        type: 'default',
        version: '1',
      });
    });

    it('should convert OpenAI manifest with service_http auth', () => {
      const openAIManifest: OpenAIPluginManifest = {
        schema_version: 'v1',
        name_for_model: 'auth_plugin',
        name_for_human: 'Auth Plugin',
        description_for_model: 'Plugin with auth',
        description_for_human: 'Plugin with authentication',
        auth: {
          type: 'service_http',
          authorization_type: 'bearer',
          verification_tokens: {
            openai: 'test-api-key-123',
          },
          instructions: '',
        },
        api: {
          type: 'openapi',
          url: 'https://example.com/openapi.json',
        },
        logo_url: 'https://example.com/logo.png',
        contact_email: 'test@example.com',
        legal_info_url: 'https://example.com/legal',
      };

      const result = convertOpenAIManifestToLobeManifest(openAIManifest);

      expect(result).toEqual({
        api: [],
        homepage: 'https://example.com/legal',
        identifier: 'auth_plugin',
        meta: {
          avatar: 'https://example.com/logo.png',
          description: 'Plugin with authentication',
          title: 'Auth Plugin',
        },
        openapi: 'https://example.com/openapi.json',
        systemRole: 'Plugin with auth',
        type: 'default',
        version: '1',
        settings: {
          properties: {
            apiAuthKey: {
              default: 'test-api-key-123',
              description: 'API Key',
              format: 'password',
              title: 'API Key',
              type: 'string',
            },
          },
          type: 'object',
        },
      });
    });

    it('should handle manifest with minimal fields', () => {
      const openAIManifest: any = {
        name_for_model: 'minimal_plugin',
        name_for_human: 'Minimal',
        description_for_model: 'Minimal description for model',
        description_for_human: 'Minimal description',
        auth: {
          type: 'none',
          instructions: '',
        },
        api: {
          type: 'openapi',
          url: 'https://example.com/api.json',
        },
      };

      const result = convertOpenAIManifestToLobeManifest(openAIManifest);

      expect(result.identifier).toBe('minimal_plugin');
      expect(result.meta.title).toBe('Minimal');
      expect(result.meta.description).toBe('Minimal description');
      expect(result.systemRole).toBe('Minimal description for model');
      expect(result.openapi).toBe('https://example.com/api.json');
      expect(result.version).toBe('1');
      expect(result.type).toBe('default');
    });
  });

  describe('getToolManifest', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      vi.restoreAllMocks();
      // Mock window to be undefined by default (server environment)
      vi.stubGlobal('window', undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should throw error when url is not provided', async () => {
      await expect(getToolManifest()).rejects.toThrow('noManifest');
    });

    it('should throw error when url is empty string', async () => {
      await expect(getToolManifest('')).rejects.toThrow('noManifest');
    });

    it('should fetch and validate Lobe manifest successfully', async () => {
      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'test_plugin',
        meta: {
          title: 'Test Plugin',
          description: 'A test plugin',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(mockManifest),
      });

      const result = await getToolManifest('https://example.com/manifest.json');

      expect(result).toEqual(mockManifest);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/manifest.json');
    });

    it('should fetch manifest using proxy when useProxy is true', async () => {
      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'test_plugin',
        meta: {
          title: 'Test Plugin',
          description: 'A test plugin',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(mockManifest),
      });

      await getToolManifest('https://example.com/manifest.json', true);

      expect(global.fetch).toHaveBeenCalledWith('/webapi/proxy', {
        body: 'https://example.com/manifest.json',
        method: 'POST',
      });
    });

    it('should parse YAML manifest when Content-Type is not application/json', async () => {
      const mockManifest = {
        api: [],
        identifier: 'yaml_plugin',
        meta: {
          title: 'YAML Plugin',
          description: 'Plugin from YAML',
        },
        type: 'default',
        version: '1',
      };

      const yamlContent = `
api: []
identifier: yaml_plugin
meta:
  title: YAML Plugin
  description: Plugin from YAML
type: default
version: '1'
`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('text/yaml'),
        },
        text: vi.fn().mockResolvedValue(yamlContent),
      });

      const result = await getToolManifest('https://example.com/manifest.yaml');

      expect(result.identifier).toBe('yaml_plugin');
      expect(result.meta.title).toBe('YAML Plugin');
    });

    it('should throw fetchError when network request fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(
        'fetchError',
      );
    });

    it('should throw fetchError when response is not ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(
        'fetchError',
      );
    });

    it('should throw urlError when response content cannot be parsed', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(
        'urlError',
      );
    });

    it('should throw manifestInvalid when manifest fails schema validation', async () => {
      const invalidManifest = {
        // Missing required fields
        identifier: 'invalid',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(invalidManifest),
      });

      await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(
        'manifestInvalid',
      );
    });

    it('should convert OpenAI manifest to Lobe manifest', async () => {
      const openAIManifest = {
        schema_version: 'v1',
        name_for_model: 'openai_plugin',
        name_for_human: 'OpenAI Plugin',
        description_for_model: 'OpenAI plugin for model',
        description_for_human: 'OpenAI plugin for humans',
        auth: {
          type: 'none',
          instructions: '',
        },
        api: {
          type: 'openapi',
          url: 'https://example.com/openapi.json',
        },
        logo_url: 'https://example.com/logo.png',
        legal_info_url: 'https://example.com/legal',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(openAIManifest),
      });

      const result = await getToolManifest('https://example.com/manifest.json');

      expect(result.identifier).toBe('openai_plugin');
      expect(result.meta.title).toBe('OpenAI Plugin');
      expect(result.openapi).toBe('https://example.com/openapi.json');
    });

    it('should skip OpenAPI processing when window is undefined (server-side)', async () => {
      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'server_plugin',
        meta: {
          title: 'Server Plugin',
          description: 'Plugin on server',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
        openapi: 'https://example.com/openapi.json',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(mockManifest),
      });

      const result = await getToolManifest('https://example.com/manifest.json');

      // Should return manifest without processing OpenAPI (since window is undefined)
      expect(result.identifier).toBe('server_plugin');
      expect(result.openapi).toBe('https://example.com/openapi.json');
      expect(result.api).toEqual([]);
    });

    it('should process OpenAPI spec when window is defined (client-side)', async () => {
      // Mock window object
      vi.stubGlobal('window', {});

      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'client_plugin',
        meta: {
          title: 'Client Plugin',
          description: 'Plugin on client',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
        openapi: 'https://example.com/openapi.json',
      };

      const mockOpenAPISpec = {
        openapi: '3.0.0',
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        paths: {
          '/test': {
            get: {
              summary: 'Test endpoint',
            },
          },
        },
      };

      const mockConvertedAPI = [
        {
          name: 'test',
          description: 'Test endpoint',
          parameters: {},
        },
      ];

      const mockConvertor = {
        convertOpenAPIToPluginSchema: vi.fn().mockResolvedValue(mockConvertedAPI),
        convertAuthToSettingsSchema: vi.fn().mockResolvedValue(undefined),
      };

      // Mock the dynamic import of OpenAPIConvertor
      vi.doMock('@lobehub/chat-plugin-sdk/openapi', () => ({
        OpenAPIConvertor: vi.fn().mockImplementation(() => mockConvertor),
      }));

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: vi.fn().mockReturnValue('application/json'),
          },
          json: vi.fn().mockResolvedValue(mockManifest),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: vi.fn().mockReturnValue('application/json'),
          },
          json: vi.fn().mockResolvedValue(mockOpenAPISpec),
        });

      const result = await getToolManifest('https://example.com/manifest.json');

      expect(result.identifier).toBe('client_plugin');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://example.com/openapi.json');
    });

    it('should throw openAPIInvalid when OpenAPI processing fails', async () => {
      // Mock window object
      vi.stubGlobal('window', {});

      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'failing_plugin',
        meta: {
          title: 'Failing Plugin',
          description: 'Plugin with invalid OpenAPI',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
        openapi: 'https://example.com/invalid-openapi.json',
      };

      // Mock the dynamic import to throw an error
      vi.doMock('@lobehub/chat-plugin-sdk/openapi', () => ({
        OpenAPIConvertor: vi.fn().mockImplementation(() => {
          throw new Error('Invalid OpenAPI spec');
        }),
      }));

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: vi.fn().mockReturnValue('application/json'),
          },
          json: vi.fn().mockResolvedValue(mockManifest),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: vi.fn().mockReturnValue('application/json'),
          },
          json: vi.fn().mockResolvedValue({}),
        });

      await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(
        'openAPIInvalid',
      );
    });

    it('should handle YAML parsing errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('text/yaml'),
        },
        text: vi.fn().mockResolvedValue('invalid: yaml: content: ['),
      });

      await expect(getToolManifest('https://example.com/manifest.yaml')).rejects.toThrow(
        'urlError',
      );
    });

    it('should handle multiple API calls with proxy', async () => {
      const mockManifest: LobeChatPluginManifest = {
        api: [],
        identifier: 'proxy_plugin',
        meta: {
          title: 'Proxy Plugin',
          description: 'Plugin via proxy',
          avatar: 'https://example.com/logo.png',
        },
        type: 'default',
        version: '1',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(mockManifest),
      });

      await getToolManifest('https://example.com/manifest.json', true);

      expect(global.fetch).toHaveBeenCalledWith('/webapi/proxy', {
        body: 'https://example.com/manifest.json',
        method: 'POST',
      });
    });
  });
});
