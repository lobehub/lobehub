// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as modelParseModule from '../../utils/modelParse';
import { LobeNewAPIAI, params } from './index';

// Mock external dependencies
vi.mock('../../utils/modelParse');

// Mock console methods
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('NewAPI Runtime - 100% Branch Coverage', () => {
  let mockFetch: Mock;
  let mockProcessMultiProviderModelList: Mock;
  let mockDetectModelProvider: Mock;

  beforeEach(() => {
    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Setup utility function mocks
    mockProcessMultiProviderModelList = vi.mocked(modelParseModule.processMultiProviderModelList);
    mockDetectModelProvider = vi.mocked(modelParseModule.detectModelProvider);

    // Clear environment variables
    delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
  });

  // ============================================================================
  // COMPREHENSIVE INTEGRATION TESTS FOR 90%+ COVERAGE
  // ============================================================================

  describe('Params Object - Runtime Configuration', () => {
    it('should export params with correct provider ID', () => {
      expect(params.id).toBe(ModelProvider.NewAPI);
    });

    it('should export params with correct defaultHeaders', () => {
      expect(params.defaultHeaders).toEqual({
        'X-Client': 'LobeHub',
      });
    });
  });

  describe('Debug Configuration - Direct Testing', () => {
    it('should return false when DEBUG_NEWAPI_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should return true when DEBUG_NEWAPI_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_NEWAPI_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
    });

    it('should return false when DEBUG_NEWAPI_CHAT_COMPLETION is set to 0', () => {
      process.env.DEBUG_NEWAPI_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
    });
  });

  describe('Routers Function - Direct Testing', () => {
    it('should generate routers with correct apiTypes', () => {
      const options = { apiKey: 'test', baseURL: 'https://api.newapi.com/v1' };
      const routers = params.routers(options);

      expect(routers).toHaveLength(5);
      expect(routers[0].apiType).toBe('anthropic');
      expect(routers[1].apiType).toBe('google');
      expect(routers[2].apiType).toBe('xai');
      expect(routers[3].apiType).toBe('deepseek');
      expect(routers[4].apiType).toBe('openai');
    });

    it('should configure deepseek router with /v1 path and openai sdkType', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      expect(routers[3].options.baseURL).toBe('https://custom.com/v1');
      expect((routers[3].options as any).sdkType).toBe('openai');
    });

    it('should process baseURL by removing version paths', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      // Anthropic router should use base URL without /v1
      expect(routers[0].options.baseURL).toBe('https://custom.com');
      // Google router should use base URL without /v1
      expect(routers[1].options.baseURL).toBe('https://custom.com');
    });

    it('should handle baseURL with v1beta', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1beta/' };
      const routers = params.routers(options);

      expect(routers[0].options.baseURL).toBe('https://custom.com');
    });

    it('should handle baseURL without version path', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com' };
      const routers = params.routers(options);

      expect(routers[0].options.baseURL).toBe('https://custom.com');
    });

    it('should configure xai router with /v1 path', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      expect(routers[2].options.baseURL).toBe('https://custom.com/v1');
    });

    it('should configure openai router with /v1 path', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      expect(routers[4].options.baseURL).toBe('https://custom.com/v1');
    });

    it('should configure openai router with useResponseModels', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      expect((routers[4].options as any).chatCompletion?.useResponseModels).toBeDefined();
    });

    it('should filter anthropic models for anthropic router', () => {
      mockDetectModelProvider.mockImplementation((id: string) => {
        if (id.includes('claude')) return 'anthropic';
        return 'openai';
      });

      const options = { apiKey: 'test', baseURL: 'https://custom.com' };
      const routers = params.routers(options);

      expect(routers[0].models).toBeDefined();
      expect(Array.isArray(routers[0].models)).toBe(true);
    });

    it('should filter google models for google router', () => {
      mockDetectModelProvider.mockImplementation((id: string) => {
        if (id.includes('gemini')) return 'google';
        return 'openai';
      });

      const options = { apiKey: 'test', baseURL: 'https://custom.com' };
      const routers = params.routers(options);

      expect(routers[1].models).toBeDefined();
      expect(Array.isArray(routers[1].models)).toBe(true);
    });

    it('should filter xai models for xai router', () => {
      mockDetectModelProvider.mockImplementation((id: string) => {
        if (id.includes('grok')) return 'xai';
        return 'openai';
      });

      const options = { apiKey: 'test', baseURL: 'https://custom.com' };
      const routers = params.routers(options);

      expect(routers[2].models).toBeDefined();
      expect(Array.isArray(routers[2].models)).toBe(true);
    });

    it('should handle missing baseURL by using empty string', () => {
      const options = { apiKey: 'test' }; // No baseURL
      const routers = params.routers(options);

      expect(routers).toHaveLength(5);
      expect(routers[0].options.baseURL).toBe('');
      expect(routers[4].options.baseURL).toBe('v1'); // urlJoin('', '/v1') returns 'v1'
    });
  });

  describe('Models Function - Integration Testing', () => {
    beforeEach(() => {
      mockProcessMultiProviderModelList.mockReturnValue([]);
    });

    it('should fetch models and process with processMultiProviderModelList', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
      });

      mockProcessMultiProviderModelList.mockReturnValue([
        {
          displayName: 'Test Model',
          id: 'test-model',
        },
      ]);

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(mockProcessMultiProviderModelList).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'test-model',
          }),
        ]),
        'newapi',
      );
      expect(result).toHaveLength(1);
    });

    it('should handle successful pricing fetch and enrich models', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              completion_ratio: 1.5,
              enable_groups: ['default'],
              model_name: 'test-model',
              model_price: 10,
              quota_type: 0,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(mockFetch).toHaveBeenCalledWith('https://api.newapi.com/api/pricing', {
        headers: {
          Accept: 'application/json; charset=utf-8',
          Authorization: 'Bearer test-key',
        },
      });

      expect(result[0].pricing).toEqual({
        units: [
          {
            name: 'textInput',
            rate: 20, // model_price * 2
            strategy: 'fixed',
            unit: 'millionTokens',
          },
          {
            name: 'textOutput',
            rate: 30, // 20 * 1.5
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      });
    });

    it('should handle pricing fetch with model_ratio instead of model_price', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              enable_groups: ['default'],
              model_name: 'test-model',
              model_ratio: 5,
              quota_type: 0,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toEqual({
        units: [
          {
            name: 'textInput',
            rate: 10, // model_ratio * 2
            strategy: 'fixed',
            unit: 'millionTokens',
          },
          {
            name: 'textOutput',
            rate: 10, // 10 * 1 (default completion_ratio)
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      });
    });

    it('should skip pricing for quota_type = 1 (pay-per-call)', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              enable_groups: ['default'],

              model_name: 'test-model',
              // Pay-per-call, not supported
              model_price: 10,
              quota_type: 1,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing fetch failure gracefully', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing fetch network error gracefully', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockRejectedValue(new Error('Network error'));

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should use dedicated proxy route when running in browser', async () => {
      // Mock browser environment
      const originalWindow = global.window;
      const originalDocument = global.document;
      global.window = {} as any;
      global.document = {} as any;

      try {
        const mockClient = {
          apiKey: 'test-key',
          baseURL: 'https://api.newapi.com/v1',
          models: {
            list: vi.fn().mockResolvedValue({
              data: [
                {
                  created: 123,
                  id: 'test-model',
                  object: 'model',
                  owned_by: 'openai',
                },
              ],
            }),
          },
        };

        mockFetch.mockResolvedValue({
          json: async () => ({
            data: [
              {
                completion_ratio: 1.5,
                enable_groups: ['default'],
                model_name: 'test-model',
                model_price: 10,
                quota_type: 0,
              },
            ],
            success: true,
          }),
          ok: true,
        });

        mockProcessMultiProviderModelList.mockImplementation((models) => models);

        const result = await params.models({ client: mockClient as any });

        expect(mockFetch).toHaveBeenCalledWith('/webapi/models/newapi/pricing');
        expect(result[0].pricing).toBeDefined();
      } finally {
        global.window = originalWindow;
        global.document = originalDocument;
      }
    });

    it('should use custom provider pricing proxy route when running in browser', async () => {
      // Mock browser environment
      const originalWindow = global.window;
      const originalDocument = global.document;
      global.window = {} as any;
      global.document = {} as any;

      try {
        const mockClient = {
          apiKey: 'test-key',
          baseURL: 'https://api.newapi.com/v1',
          models: {
            list: vi.fn().mockResolvedValue({
              data: [
                {
                  created: 123,
                  id: 'custom-model',
                  object: 'model',
                  owned_by: 'openai',
                },
              ],
            }),
          },
        };

        mockFetch.mockResolvedValue({
          json: async () => ({
            data: [
              {
                completion_ratio: 1.5,
                enable_groups: ['default'],
                model_name: 'custom-model',
                model_price: 10,
                quota_type: 0,
              },
            ],
            success: true,
          }),
          ok: true,
        });

        mockProcessMultiProviderModelList.mockImplementation((models) => models);

        const result = await params.models({
          client: mockClient as any,
          options: { providerId: 'custom-router' },
        });

        expect(mockFetch).toHaveBeenCalledWith('/webapi/models/custom-router/pricing');
        expect(result[0].pricing).toBeDefined();
      } finally {
        global.window = originalWindow;
        global.document = originalDocument;
      }
    });

    it('should handle pricing data with success=false', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [],
          success: false,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing data with missing data field', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'test-model',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          success: true,
          // Missing data field
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
      });

      mockProcessMultiProviderModelList.mockReturnValue([]);

      const result = await params.models({ client: mockClient as any });

      expect(result).toEqual([]);
    });

    it('should handle undefined model data', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: undefined,
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
      });

      mockProcessMultiProviderModelList.mockReturnValue([]);

      const result = await params.models({ client: mockClient as any });

      expect(mockProcessMultiProviderModelList).toHaveBeenCalledWith([], 'newapi');
      expect(result).toEqual([]);
    });

    it('should strip version paths from baseURL correctly', async () => {
      const testCases = [
        { expected: 'https://api.com', input: 'https://api.com/v1' },
        { expected: 'https://api.com', input: 'https://api.com/v1/' },
        { expected: 'https://api.com', input: 'https://api.com/v1beta' },
        { expected: 'https://api.com', input: 'https://api.com/v2alpha/' },
        { expected: 'https://api.com', input: 'https://api.com' },
      ];

      for (const testCase of testCases) {
        const mockClient = {
          apiKey: 'test-key',
          baseURL: testCase.input,
          models: {
            list: vi.fn().mockResolvedValue({ data: [] }),
          },
        };

        mockFetch.mockResolvedValue({ ok: false });
        mockProcessMultiProviderModelList.mockReturnValue([]);

        await params.models({ client: mockClient as any });

        if (testCase.input !== testCase.expected) {
          expect(mockFetch).toHaveBeenCalledWith(
            `${testCase.expected}/api/pricing`,
            expect.any(Object),
          );
        }
      }
    });

    it('should add models from pricing list that are not in models list', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'model-a',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              enable_groups: ['default'],
              model_name: 'model-a',
              model_price: 10,
              quota_type: 0,
            },
            {
              completion_ratio: 2,
              enable_groups: ['default'],

              model_name: 'model-b',

              model_price: 20,
              // Only in pricing, not in models
              quota_type: 0,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      // Should have 2 models: model-a from /v1/models and model-b from pricing
      expect(result).toHaveLength(2);
      expect(result.find((m: any) => m.id === 'model-a')).toBeDefined();
      expect(result.find((m: any) => m.id === 'model-b')).toBeDefined();

      // model-b should have pricing info
      const modelB = result.find((m: any) => m.id === 'model-b') as any;
      expect(modelB).toBeDefined();
      expect(modelB.pricing).toEqual({
        units: [
          {
            name: 'textInput',
            rate: 40, // model_price * 2
            strategy: 'fixed',
            unit: 'millionTokens',
          },
          {
            name: 'textOutput',
            rate: 80, // 40 * 2
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      });
    });

    it('should not duplicate models that exist in both lists', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                created: 123,
                id: 'model-a',
                object: 'model',
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              enable_groups: ['default'],
              model_name: 'model-a',

              model_price: 10,
              // Same as in models list
              quota_type: 0,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      // Should have only 1 model, not duplicated
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('model-a');
    });

    it('should verify that additionalModels get processed with displayName and type through processMultiProviderModelList', async () => {
      const mockClient = {
        apiKey: 'test-key',
        baseURL: 'https://api.newapi.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        json: async () => ({
          data: [
            {
              enable_groups: ['default'],
              model_name: 'new-model-from-pricing',
              model_price: 15,
              quota_type: 0,
            },
          ],
          success: true,
        }),
        ok: true,
      });

      // Mock processMultiProviderModelList to simulate the real behavior of adding displayName and type
      mockProcessMultiProviderModelList.mockImplementation((models) =>
        models.map((m: any) => ({
          ...m,
          displayName: m.displayName || m.id, // processModelCard adds displayName
          enabled: m.enabled || false,
          type: m.type || 'chat', // processModelCard adds type
        })),
      );

      const result = await params.models({ client: mockClient as any });

      // Verify the model was added from pricing
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new-model-from-pricing');

      // Verify that processMultiProviderModelList was called with the additionalModels
      expect(mockProcessMultiProviderModelList).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'new-model-from-pricing',
            pricing: expect.objectContaining({
              units: expect.arrayContaining([
                expect.objectContaining({ name: 'textInput' }),
                expect.objectContaining({ name: 'textOutput' }),
              ]),
            }),
          }),
        ]),
        'newapi',
      );

      // Verify that after processing, the model has the required fields
      expect(result[0]).toHaveProperty('displayName');
      expect(result[0]).toHaveProperty('type');
      expect(result[0].displayName).toBe('new-model-from-pricing'); // Falls back to id
      expect(result[0].type).toBe('chat'); // Default type
    });
  });

  describe('Runtime Instance Creation', () => {
    it('should create instance with minimal options', () => {
      const instance = new LobeNewAPIAI({ apiKey: 'test-key' });
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(LobeNewAPIAI);
    });
  });
});
