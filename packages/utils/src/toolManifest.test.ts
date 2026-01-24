import { OpenAIPluginManifest } from '@lobechat/types';
import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertOpenAIManifestToLobeManifest, getToolManifest } from './toolManifest';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('convertOpenAIManifestToLobeManifest', () => {
  it('should convert OpenAI manifest with no auth to Lobe manifest', () => {
    const openAIManifest: OpenAIPluginManifest = {
      api: {
        type: 'openapi',
        url: 'https://example.com/openapi.json',
      },
      auth: {
        instructions: '',
        type: 'none',
      },
      contact_email: 'contact@example.com',
      description_for_human: 'A test plugin',
      description_for_model: 'System role for the model',
      legal_info_url: 'https://example.com/legal',
      logo_url: 'https://example.com/logo.png',
      name_for_human: 'Test Plugin',
      name_for_model: 'test_plugin',
      schema_version: 'v1',
    };

    const result = convertOpenAIManifestToLobeManifest(openAIManifest);

    expect(result).toEqual({
      api: [],
      homepage: 'https://example.com/legal',
      identifier: 'test_plugin',
      meta: {
        avatar: 'https://example.com/logo.png',
        description: 'A test plugin',
        title: 'Test Plugin',
      },
      openapi: 'https://example.com/openapi.json',
      systemRole: 'System role for the model',
      type: 'default',
      version: '1',
    });
  });

  it('should convert OpenAI manifest with service_http auth to Lobe manifest with settings', () => {
    const openAIManifest: OpenAIPluginManifest = {
      api: {
        type: 'openapi',
        url: 'https://example.com/openapi.json',
      },
      auth: {
        authorization_type: 'bearer',
        instructions: '',
        type: 'service_http',
        verification_tokens: {
          openai: 'test-token-123',
        },
      },
      contact_email: 'contact@example.com',
      description_for_human: 'A test plugin with auth',
      description_for_model: 'System role for the model',
      legal_info_url: 'https://example.com/legal',
      logo_url: 'https://example.com/logo.png',
      name_for_human: 'Test Plugin',
      name_for_model: 'test_plugin',
      schema_version: 'v1',
    };

    const result = convertOpenAIManifestToLobeManifest(openAIManifest);

    expect(result).toEqual({
      api: [],
      homepage: 'https://example.com/legal',
      identifier: 'test_plugin',
      meta: {
        avatar: 'https://example.com/logo.png',
        description: 'A test plugin with auth',
        title: 'Test Plugin',
      },
      openapi: 'https://example.com/openapi.json',
      settings: {
        properties: {
          apiAuthKey: {
            default: 'test-token-123',
            description: 'API Key',
            format: 'password',
            title: 'API Key',
            type: 'string',
          },
        },
        type: 'object',
      },
      systemRole: 'System role for the model',
      type: 'default',
      version: '1',
    });
  });

  it('should handle missing optional fields in OpenAI manifest', () => {
    const openAIManifest: OpenAIPluginManifest = {
      api: {
        type: 'openapi',
        url: 'https://example.com/openapi.json',
      },
      auth: {
        instructions: '',
        type: 'none',
      },
      contact_email: 'contact@example.com',
      description_for_human: 'A minimal plugin',
      description_for_model: 'Minimal system role',
      legal_info_url: '',
      logo_url: '',
      name_for_human: 'Minimal Plugin',
      name_for_model: 'minimal_plugin',
      schema_version: 'v1',
    };

    const result = convertOpenAIManifestToLobeManifest(openAIManifest);

    expect(result.homepage).toBe('');
    expect(result.meta.avatar).toBe('');
    expect(result.identifier).toBe('minimal_plugin');
  });
});

describe('getToolManifest', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
  });

  it('should throw error when url is undefined', async () => {
    await expect(getToolManifest(undefined)).rejects.toThrow(TypeError);
    await expect(getToolManifest(undefined)).rejects.toThrow('noManifest');
  });

  it('should throw error when url is empty string', async () => {
    await expect(getToolManifest('')).rejects.toThrow(TypeError);
    await expect(getToolManifest('')).rejects.toThrow('noManifest');
  });

  it('should fetch and parse valid Lobe manifest JSON', async () => {
    const manifest: LobeChatPluginManifest = {
      api: [
        {
          description: 'Test API',
          name: 'testApi',
          parameters: {
            properties: {},
            type: 'object',
          },
        },
      ],
      identifier: 'test-plugin',
      meta: {
        avatar: '🧩',
        description: 'Test plugin',
        title: 'Test',
      },
      type: 'default',
      version: '1',
    };

    mockFetch.mockResolvedValueOnce({
      headers: {
        get: vi.fn().mockReturnValue('application/json'),
      },
      json: vi.fn().mockResolvedValue(manifest),
      ok: true,
    });

    const result = await getToolManifest('https://example.com/manifest.json');

    expect(result).toEqual(manifest);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/manifest.json');
  });

  it('should fetch manifest with proxy when useProxy is true', async () => {
    const manifest: LobeChatPluginManifest = {
      api: [],
      identifier: 'test-plugin',
      meta: {
        avatar: '🧩',
        description: 'Test plugin',
        title: 'Test',
      },
      type: 'default',
      version: '1',
    };

    mockFetch.mockResolvedValueOnce({
      headers: {
        get: vi.fn().mockReturnValue('application/json'),
      },
      json: vi.fn().mockResolvedValue(manifest),
      ok: true,
    });

    await getToolManifest('https://example.com/manifest.json', true);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/proxy'), {
      body: 'https://example.com/manifest.json',
      method: 'POST',
    });
  });

  it('should throw error when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(TypeError);
  });

  it('should throw error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(TypeError);
  });

  it('should parse YAML manifest when content type is not JSON', async () => {
    const yamlContent = `
api: []
identifier: test-plugin
meta:
  title: Test
  description: Test plugin
type: default
version: '1'
`;

    mockFetch.mockResolvedValueOnce({
      headers: {
        get: vi.fn().mockReturnValue('text/yaml'),
      },
      ok: true,
      text: vi.fn().mockResolvedValue(yamlContent),
    });

    const result = await getToolManifest('https://example.com/manifest.yaml');

    expect(result.identifier).toBe('test-plugin');
    expect(result.meta.title).toBe('Test');
  });

  it('should throw error when JSON/YAML parsing fails', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: {
        get: vi.fn().mockReturnValue('application/json'),
      },
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      ok: true,
    });

    await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(TypeError);
  });

  it('should convert OpenAI manifest to Lobe manifest', async () => {
    const openAIManifest: OpenAIPluginManifest = {
      api: {
        type: 'openapi',
        url: 'https://example.com/openapi.json',
      },
      auth: {
        instructions: '',
        type: 'none',
      },
      contact_email: 'contact@example.com',
      description_for_human: 'A test plugin',
      description_for_model: 'System role',
      legal_info_url: 'https://example.com/legal',
      logo_url: 'https://example.com/logo.png',
      name_for_human: 'Test Plugin',
      name_for_model: 'test_plugin',
      schema_version: 'v1',
    };

    const openAPISpec = {
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {},
    };

    mockFetch
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(openAIManifest),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(openAPISpec),
        ok: true,
      });

    const result = await getToolManifest('https://example.com/ai-plugin.json');

    expect(result.identifier).toBe('test_plugin');
    expect(result.meta.title).toBe('Test Plugin');
    expect(result.systemRole).toBe('System role');
    expect(result.openapi).toBe('https://example.com/openapi.json');
  });

  it('should throw error when manifest schema validation fails', async () => {
    const invalidManifest = {
      // Missing required fields
      identifier: 'test',
    };

    mockFetch.mockResolvedValueOnce({
      headers: {
        get: vi.fn().mockReturnValue('application/json'),
      },
      json: vi.fn().mockResolvedValue(invalidManifest),
      ok: true,
    });

    await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(TypeError);
  });

  it('should handle manifest with openapi field in browser environment', async () => {
    const manifest: LobeChatPluginManifest = {
      api: [],
      identifier: 'test-plugin',
      meta: {
        avatar: '🧩',
        description: 'Test plugin',
        title: 'Test',
      },
      openapi: 'https://example.com/openapi.json',
      type: 'default',
      version: '1',
    };

    const openAPISpec = {
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/test': {
          get: {
            description: 'Test endpoint',
            operationId: 'testOp',
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    };

    // Mock window to simulate browser environment
    // @ts-expect-error: Mocking window object
    global.window = {};

    mockFetch
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(manifest),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(openAPISpec),
        ok: true,
      });

    const result = await getToolManifest('https://example.com/manifest.json');

    expect(result.identifier).toBe('test-plugin');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.api.length).toBeGreaterThan(0);

    // Clean up
    // @ts-expect-error: Cleaning up mock
    delete global.window;
  });

  it('should handle invalid openapi spec with proper error', async () => {
    const manifest: LobeChatPluginManifest = {
      api: [],
      identifier: 'test-plugin',
      meta: {
        avatar: '🧩',
        description: 'Test plugin',
        title: 'Test',
      },
      openapi: 'https://example.com/openapi.json',
      type: 'default',
      version: '1',
    };

    const invalidOpenAPISpec = {
      // Invalid OpenAPI spec
      invalid: 'spec',
    };

    // @ts-expect-error: Mocking window object
    global.window = {};

    mockFetch
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(manifest),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(invalidOpenAPISpec),
        ok: true,
      });

    await expect(getToolManifest('https://example.com/manifest.json')).rejects.toThrow(TypeError);

    // Clean up
    // @ts-expect-error: Cleaning up mock
    delete global.window;
  });

  it('should skip OpenAPI processing in server environment', async () => {
    const manifest: LobeChatPluginManifest = {
      api: [],
      identifier: 'test-plugin',
      meta: {
        avatar: '🧩',
        description: 'Test plugin',
        title: 'Test',
      },
      openapi: 'https://example.com/openapi.json',
      type: 'default',
      version: '1',
    };

    const openAPISpec = {
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {},
    };

    mockFetch
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(manifest),
        ok: true,
      })
      .mockResolvedValueOnce({
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(openAPISpec),
        ok: true,
      });

    // Ensure we're in server environment (window is undefined)
    const result = await getToolManifest('https://example.com/manifest.json');

    expect(result.identifier).toBe('test-plugin');
    // Should fetch both manifest and openapi spec, but skip conversion in server environment
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // API should remain empty as conversion is skipped in server environment
    expect(result.api).toEqual([]);
  });
});
