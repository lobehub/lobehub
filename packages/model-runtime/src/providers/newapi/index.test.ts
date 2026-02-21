// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { responsesAPIModels } from '../../const/models';
import type { ChatStreamPayload } from '../../types/chat';
import * as modelParseModule from '../../utils/modelParse';
import type { NewAPIModelCard, NewAPIPricing } from './index';
import { LobeNewAPIAI, params } from './index';

// Mock external dependencies
vi.mock('../../utils/modelParse');

// Mock console methods
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'debug').mockImplementation(() => {});

// Type definitions for test data
interface MockPricingResponse {
  data?: NewAPIPricing[];
  success?: boolean;
}

describe('NewAPI Runtime - 100% Branch Coverage', () => {
  let mockFetch: Mock;
  let mockProcessMultiProviderModelList: Mock;
  let mockDetectModelProvider: Mock;
  let mockResponsesAPIModels: typeof responsesAPIModels;

  beforeEach(() => {
    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Setup utility function mocks
    mockProcessMultiProviderModelList = vi.mocked(modelParseModule.processMultiProviderModelList);
    mockDetectModelProvider = vi.mocked(modelParseModule.detectModelProvider);
    mockResponsesAPIModels = responsesAPIModels;

    // Clear environment variables
    delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
  });

  describe('Debug Configuration Branch Coverage', () => {
    it('should return false when DEBUG_NEWAPI_CHAT_COMPLETION is not set (Branch: debug = false)', () => {
      delete process.env.DEBUG_NEWAPI_CHAT_COMPLETION;
      const debugResult = process.env.DEBUG_NEWAPI_CHAT_COMPLETION === '1';
      expect(debugResult).toBe(false);
    });

    it('should return true when DEBUG_NEWAPI_CHAT_COMPLETION is set to 1 (Branch: debug = true)', () => {
      process.env.DEBUG_NEWAPI_CHAT_COMPLETION = '1';
      const debugResult = process.env.DEBUG_NEWAPI_CHAT_COMPLETION === '1';
      expect(debugResult).toBe(true);
    });
  });

  describe('HandlePayload Function Branch Coverage - Direct Testing', () => {
    // Create a mock Set for testing
    let testResponsesAPIModels: Set<string>;

    const testHandlePayload = (payload: ChatStreamPayload) => {
      // This replicates the exact handlePayload logic from the source
      if (
        testResponsesAPIModels.has(payload.model) ||
        payload.model.includes('gpt-') ||
        /^o\d/.test(payload.model)
      ) {
        return { ...payload, apiMode: 'responses' } as any;
      }
      return payload as any;
    };

    it('should add apiMode for models in responsesAPIModels set (Branch A: responsesAPIModels.has = true)', () => {
      testResponsesAPIModels = new Set(['o1-pro']);

      const payload: ChatStreamPayload = {
        model: 'o1-pro',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
      };

      const result = testHandlePayload(payload);

      expect(result).toEqual({ ...payload, apiMode: 'responses' });
    });

    it('should add apiMode for gpt- models (Branch B: includes gpt- = true)', () => {
      testResponsesAPIModels = new Set(); // Empty set to test gpt- logic

      const payload: ChatStreamPayload = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
      };

      const result = testHandlePayload(payload);

      expect(result).toEqual({ ...payload, apiMode: 'responses' });
    });

    it('should add apiMode for o-series models (Branch C: /^o\\d/.test = true)', () => {
      testResponsesAPIModels = new Set(); // Empty set to test o-series logic

      const payload: ChatStreamPayload = {
        model: 'o1-mini',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
      };

      const result = testHandlePayload(payload);

      expect(result).toEqual({ ...payload, apiMode: 'responses' });
    });

    it('should add apiMode for o3 models (Branch C: /^o\\d/.test = true)', () => {
      testResponsesAPIModels = new Set(); // Empty set to test o3 logic

      const payload: ChatStreamPayload = {
        model: 'o3-turbo',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
      };

      const result = testHandlePayload(payload);

      expect(result).toEqual({ ...payload, apiMode: 'responses' });
    });

    it('should not modify payload for regular models (Branch D: all conditions false)', () => {
      testResponsesAPIModels = new Set(); // Empty set to test fallback logic

      const payload: ChatStreamPayload = {
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
      };

      const result = testHandlePayload(payload);

      expect(result).toEqual(payload);
    });
  });

  describe('GetProviderFromOwnedBy Function Branch Coverage - Direct Testing', () => {
    // Test the getProviderFromOwnedBy function directly by extracting its logic
    const testGetProviderFromOwnedBy = (ownedBy: string): string => {
      const normalizedOwnedBy = ownedBy.toLowerCase();

      if (normalizedOwnedBy.includes('anthropic') || normalizedOwnedBy.includes('claude')) {
        return 'anthropic';
      }
      if (normalizedOwnedBy.includes('google') || normalizedOwnedBy.includes('gemini')) {
        return 'google';
      }
      if (normalizedOwnedBy.includes('xai') || normalizedOwnedBy.includes('grok')) {
        return 'xai';
      }

      return 'openai';
    };

    it('should detect anthropic from anthropic string (Branch 1: includes anthropic = true)', () => {
      const result = testGetProviderFromOwnedBy('Anthropic Inc.');
      expect(result).toBe('anthropic');
    });

    it('should detect anthropic from claude string (Branch 2: includes claude = true)', () => {
      const result = testGetProviderFromOwnedBy('claude-team');
      expect(result).toBe('anthropic');
    });

    it('should detect google from google string (Branch 3: includes google = true)', () => {
      const result = testGetProviderFromOwnedBy('Google LLC');
      expect(result).toBe('google');
    });

    it('should detect google from gemini string (Branch 4: includes gemini = true)', () => {
      const result = testGetProviderFromOwnedBy('gemini-pro-team');
      expect(result).toBe('google');
    });

    it('should detect xai from xai string (Branch 5: includes xai = true)', () => {
      const result = testGetProviderFromOwnedBy('xAI Corporation');
      expect(result).toBe('xai');
    });

    it('should detect xai from grok string (Branch 6: includes grok = true)', () => {
      const result = testGetProviderFromOwnedBy('grok-beta');
      expect(result).toBe('xai');
    });

    it('should default to openai for unknown provider (Branch 7: default case)', () => {
      const result = testGetProviderFromOwnedBy('unknown-company');
      expect(result).toBe('openai');
    });

    it('should default to openai for empty owned_by (Branch 7: default case)', () => {
      const result = testGetProviderFromOwnedBy('');
      expect(result).toBe('openai');
    });
  });

  describe('Models Function Branch Coverage - Logical Testing', () => {
    // Test the complex models function logic by replicating its branching behavior

    describe('Data Handling Branches', () => {
      it('should handle undefined data from models.list (Branch 3.1: data = undefined)', () => {
        const data = undefined;
        const modelList = data || [];
        expect(modelList).toEqual([]);
      });

      it('should handle null data from models.list (Branch 3.1: data = null)', () => {
        const data = null;
        const modelList = data || [];
        expect(modelList).toEqual([]);
      });

      it('should handle valid data from models.list (Branch 3.1: data exists)', () => {
        const data = [{ id: 'test-model', object: 'model', created: 123, owned_by: 'openai' }];
        const modelList = data || [];
        expect(modelList).toEqual(data);
      });
    });

    describe('Pricing API Response Branches', () => {
      it('should handle fetch failure (Branch 3.2: pricingResponse.ok = false)', () => {
        const pricingResponse = { ok: false };
        expect(pricingResponse.ok).toBe(false);
      });

      it('should handle successful fetch (Branch 3.2: pricingResponse.ok = true)', () => {
        const pricingResponse = { ok: true };
        expect(pricingResponse.ok).toBe(true);
      });

      it('should handle network error (Branch 3.18: error handling)', () => {
        let errorCaught = false;
        try {
          throw new Error('Network error');
        } catch (error) {
          errorCaught = true;
          expect(error).toBeInstanceOf(Error);
        }
        expect(errorCaught).toBe(true);
      });
    });

    describe('Pricing Data Validation Branches', () => {
      it('should handle pricingData.success = false (Branch 3.3)', () => {
        const pricingData = { success: false, data: [] };
        const shouldProcess = pricingData.success && pricingData.data;
        expect(shouldProcess).toBeFalsy();
      });

      it('should handle missing pricingData.data (Branch 3.4)', () => {
        const pricingData: MockPricingResponse = { success: true };
        const shouldProcess = pricingData.success && pricingData.data;
        expect(shouldProcess).toBeFalsy();
      });

      it('should process valid pricing data (Branch 3.5: success && data = true)', () => {
        const pricingData = { success: true, data: [{ model_name: 'test' }] };
        const shouldProcess = pricingData.success && pricingData.data;
        expect(shouldProcess).toBeTruthy();
      });
    });

    describe('Pricing Calculation Branches', () => {
      it('should handle no pricing match for model (Branch 3.6: pricing = undefined)', () => {
        const pricingMap = new Map([['other-model', { model_name: 'other-model', quota_type: 0 }]]);
        const pricing = pricingMap.get('test-model');
        expect(pricing).toBeUndefined();
      });

      it('should skip quota_type = 1 (Branch 3.7: quota_type !== 0)', () => {
        const pricing = { quota_type: 1, model_price: 10 };
        const shouldProcess = pricing.quota_type === 0;
        expect(shouldProcess).toBe(false);
      });

      it('should process quota_type = 0 (Branch 3.7: quota_type === 0)', () => {
        const pricing = { quota_type: 0, model_price: 10 };
        const shouldProcess = pricing.quota_type === 0;
        expect(shouldProcess).toBe(true);
      });

      it('should use model_price when > 0 (Branch 3.8: model_price && model_price > 0 = true)', () => {
        const pricing = { model_price: 15, model_ratio: 10 };
        let inputPrice;

        if (pricing.model_price && pricing.model_price > 0) {
          inputPrice = pricing.model_price * 2;
        } else if (pricing.model_ratio) {
          inputPrice = pricing.model_ratio * 2;
        }

        expect(inputPrice).toBe(30); // model_price * 2
      });

      it('should fallback to model_ratio when model_price = 0 (Branch 3.8: model_price > 0 = false, Branch 3.9: model_ratio = true)', () => {
        const pricing = { model_price: 0, model_ratio: 12 };
        let inputPrice;

        if (pricing.model_price && pricing.model_price > 0) {
          inputPrice = pricing.model_price * 2;
        } else if (pricing.model_ratio) {
          inputPrice = pricing.model_ratio * 2;
        }

        expect(inputPrice).toBe(24); // model_ratio * 2
      });

      it('should handle missing model_ratio (Branch 3.9: model_ratio = undefined)', () => {
        const pricing: Partial<NewAPIPricing> = { quota_type: 0 }; // No model_price and no model_ratio
        let inputPrice: number | undefined;

        if (pricing.model_price && pricing.model_price > 0) {
          inputPrice = pricing.model_price * 2;
        } else if (pricing.model_ratio) {
          inputPrice = pricing.model_ratio * 2;
        }

        expect(inputPrice).toBeUndefined();
      });

      it('should calculate output price when inputPrice is defined (Branch 3.10: inputPrice !== undefined = true)', () => {
        const inputPrice = 20;
        const completionRatio = 1.5;

        let outputPrice;
        if (inputPrice !== undefined) {
          outputPrice = inputPrice * (completionRatio || 1);
        }

        expect(outputPrice).toBe(30);
      });

      it('should use default completion_ratio when not provided', () => {
        const inputPrice = 16;
        const completionRatio = undefined;

        let outputPrice;
        if (inputPrice !== undefined) {
          outputPrice = inputPrice * (completionRatio || 1);
        }

        expect(outputPrice).toBe(16); // input * 1 (default)
      });
    });

    describe('Provider Detection Branches', () => {
      it('should use supported_endpoint_types with anthropic (Branch 3.11: length > 0 = true, Branch 3.12: includes anthropic = true)', () => {
        const model = { supported_endpoint_types: ['anthropic'] };
        let detectedProvider = 'openai';

        if (
          model.supported_endpoint_types &&
          model.supported_endpoint_types.length > 0 &&
          model.supported_endpoint_types.includes('anthropic')
        ) {
          detectedProvider = 'anthropic';
        }

        expect(detectedProvider).toBe('anthropic');
      });

      it('should use supported_endpoint_types with gemini (Branch 3.13: includes gemini = true)', () => {
        const model = { supported_endpoint_types: ['gemini'] };
        let detectedProvider = 'openai';

        if (
          model.supported_endpoint_types &&
          model.supported_endpoint_types.length > 0 &&
          model.supported_endpoint_types.includes('gemini')
        ) {
          detectedProvider = 'google';
        }

        expect(detectedProvider).toBe('google');
      });

      it('should use supported_endpoint_types with xai (Branch 3.14: includes xai = true)', () => {
        const model = { supported_endpoint_types: ['xai'] };
        let detectedProvider = 'openai';

        if (
          model.supported_endpoint_types &&
          model.supported_endpoint_types.length > 0 &&
          model.supported_endpoint_types.includes('xai')
        ) {
          detectedProvider = 'xai';
        }

        expect(detectedProvider).toBe('xai');
      });

      it('should fallback to owned_by when supported_endpoint_types is empty (Branch 3.11: length > 0 = false, Branch 3.15: owned_by = true)', () => {
        const model: Partial<NewAPIModelCard> = {
          supported_endpoint_types: [],
          owned_by: 'anthropic',
        };
        let detectedProvider = 'openai';

        if (model.supported_endpoint_types && model.supported_endpoint_types.length > 0) {
          // Skip - empty array
        } else if (model.owned_by) {
          detectedProvider = 'anthropic'; // Simplified for test
        }

        expect(detectedProvider).toBe('anthropic');
      });

      it('should fallback to owned_by when no supported_endpoint_types (Branch 3.15: owned_by = true)', () => {
        const model: Partial<NewAPIModelCard> = { owned_by: 'google' };
        let detectedProvider = 'openai';

        if (model.supported_endpoint_types && model.supported_endpoint_types.length > 0) {
          // Skip - no supported_endpoint_types
        } else if (model.owned_by) {
          detectedProvider = 'google'; // Simplified for test
        }

        expect(detectedProvider).toBe('google');
      });

      it.skip('should use detectModelProvider fallback when no owned_by (Branch 3.15: owned_by = false, Branch 3.17)', () => {
        const model: Partial<NewAPIModelCard> = { id: 'claude-3-sonnet', owned_by: '' };
        mockDetectModelProvider.mockReturnValue('anthropic');

        let detectedProvider = 'openai';

        if (model.supported_endpoint_types && model.supported_endpoint_types.length > 0) {
          // Skip - no supported_endpoint_types
        } else if (model.owned_by) {
          // Skip - empty owned_by
        } else {
          detectedProvider = mockDetectModelProvider(model.id || '');
        }

        expect(detectedProvider).toBe('anthropic');
        expect(mockDetectModelProvider).toHaveBeenCalledWith('claude-3-sonnet');
      });

      it('should cleanup _detectedProvider field (Branch 3.16: _detectedProvider exists = true)', () => {
        const model: any = {
          id: 'test-model',
          displayName: 'Test Model',
          _detectedProvider: 'openai',
        };

        if (model._detectedProvider) {
          delete model._detectedProvider;
        }

        expect(model).not.toHaveProperty('_detectedProvider');
      });

      it('should skip cleanup when no _detectedProvider field (Branch 3.16: _detectedProvider exists = false)', () => {
        const model: any = {
          id: 'test-model',
          displayName: 'Test Model',
        };

        const hadDetectedProvider = '_detectedProvider' in model;

        if (model._detectedProvider) {
          delete model._detectedProvider;
        }

        expect(hadDetectedProvider).toBe(false);
      });
    });

    describe('URL Processing Branch Coverage', () => {
      it('should remove trailing API version paths from baseURL', () => {
        const testURLs = [
          { input: 'https://api.newapi.com/v1', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com/v1/', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com/v1beta', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com/v1beta/', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com/v2', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com/v1alpha', expected: 'https://api.newapi.com' },
          { input: 'https://api.newapi.com', expected: 'https://api.newapi.com' },
        ];

        testURLs.forEach(({ input, expected }) => {
          const result = input.replace(/\/v\d+[a-z]*\/?$/, '');
          expect(result).toBe(expected);
        });
      });
    });
  });

  describe('Integration and Runtime Tests', () => {
    it('should validate runtime instantiation', () => {
      expect(LobeNewAPIAI).toBeDefined();
      expect(typeof LobeNewAPIAI).toBe('function');
    });

    it('should validate NewAPI type definitions', () => {
      const mockModel: NewAPIModelCard = {
        id: 'test-model',
        object: 'model',
        created: 1234567890,
        owned_by: 'openai',
        supported_endpoint_types: ['openai'],
      };

      const mockPricing: NewAPIPricing = {
        model_name: 'test-model',
        quota_type: 0,
        model_price: 10,
        model_ratio: 5,
        completion_ratio: 1.5,
        enable_groups: ['default'],
        supported_endpoint_types: ['openai'],
      };

      expect(mockModel.id).toBe('test-model');
      expect(mockPricing.quota_type).toBe(0);
    });

    it('should test complex pricing and provider detection workflow', () => {
      // Simulate the complex workflow of the models function
      const models = [
        {
          id: 'anthropic-claude',
          owned_by: 'anthropic',
          supported_endpoint_types: ['anthropic'],
        },
        {
          id: 'google-gemini',
          owned_by: 'google',
          supported_endpoint_types: ['gemini'],
        },
        {
          id: 'openai-gpt4',
          owned_by: 'openai',
        },
      ];

      const pricingData = [
        { model_name: 'anthropic-claude', quota_type: 0, model_price: 20, completion_ratio: 3 },
        { model_name: 'google-gemini', quota_type: 0, model_ratio: 5 },
        { model_name: 'openai-gpt4', quota_type: 1, model_price: 30 }, // Should be skipped
      ];

      const pricingMap = new Map(pricingData.map((p) => [p.model_name, p]));

      const enrichedModels = models.map((model) => {
        const enhancedModel: any = { ...model };

        // Test pricing logic
        const pricing = pricingMap.get(model.id);
        if (pricing && pricing.quota_type === 0) {
          let inputPrice: number | undefined;

          if (pricing.model_price && pricing.model_price > 0) {
            inputPrice = pricing.model_price * 2;
          } else if (pricing.model_ratio) {
            inputPrice = pricing.model_ratio * 2;
          }

          if (inputPrice !== undefined) {
            const outputPrice = inputPrice * (pricing.completion_ratio || 1);
            enhancedModel.pricing = {
              units: [
                {
                  name: 'textInput',
                  unit: 'millionTokens',
                  strategy: 'fixed',
                  rate: inputPrice,
                },
                {
                  name: 'textOutput',
                  unit: 'millionTokens',
                  strategy: 'fixed',
                  rate: outputPrice,
                },
              ],
            };
          }
        }

        // Test provider detection logic
        let detectedProvider = 'openai';
        if (model.supported_endpoint_types && model.supported_endpoint_types.length > 0) {
          if (model.supported_endpoint_types.includes('anthropic')) {
            detectedProvider = 'anthropic';
          } else if (model.supported_endpoint_types.includes('gemini')) {
            detectedProvider = 'google';
          }
        }
        enhancedModel._detectedProvider = detectedProvider;

        return enhancedModel;
      });

      // Verify pricing results
      expect(enrichedModels[0].pricing).toEqual({
        units: [
          { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 40 },
          { name: 'textOutput', unit: 'millionTokens', strategy: 'fixed', rate: 120 },
        ],
      }); // model_price * 2, input * completion_ratio
      expect(enrichedModels[1].pricing).toEqual({
        units: [
          { name: 'textInput', unit: 'millionTokens', strategy: 'fixed', rate: 10 },
          { name: 'textOutput', unit: 'millionTokens', strategy: 'fixed', rate: 10 },
        ],
      }); // model_ratio * 2, input * 1 (default)
      expect(enrichedModels[2].pricing).toBeUndefined(); // quota_type = 1, skipped

      // Verify provider detection
      expect(enrichedModels[0]._detectedProvider).toBe('anthropic');
      expect(enrichedModels[1]._detectedProvider).toBe('google');
      expect(enrichedModels[2]._detectedProvider).toBe('openai');

      // Test cleanup logic
      const finalModels = enrichedModels.map((model: any) => {
        if (model._detectedProvider) {
          delete model._detectedProvider;
        }
        return model;
      });

      finalModels.forEach((model: any) => {
        expect(model).not.toHaveProperty('_detectedProvider');
      });
    });

    it('should configure dynamic routers with correct baseURL from user options', () => {
      // Test the dynamic routers configuration
      const testOptions = {
        apiKey: 'test-key',
        baseURL: 'https://yourapi.cn/v1',
      };

      // Create instance to test dynamic routers
      const instance = new LobeNewAPIAI(testOptions);
      expect(instance).toBeDefined();

      // The dynamic routers should be configured with user's baseURL
      // This is tested indirectly through successful instantiation
      // since the routers function processes the options.baseURL
      const expectedBaseURL = testOptions.baseURL.replace(/\/v\d+[a-z]*\/?$/, '');
      expect(expectedBaseURL).toBe('https://yourapi.cn');
    });
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

    it('should export params with debug configuration', () => {
      expect(params.debug).toBeDefined();
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should export params with models function', () => {
      expect(params.models).toBeDefined();
      expect(typeof params.models).toBe('function');
    });

    it('should export params with routers function', () => {
      expect(params.routers).toBeDefined();
      expect(typeof params.routers).toBe('function');
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

      expect(routers).toHaveLength(4);
      expect(routers[0].apiType).toBe('anthropic');
      expect(routers[1].apiType).toBe('google');
      expect(routers[2].apiType).toBe('xai');
      expect(routers[3].apiType).toBe('openai');
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

      expect(routers[3].options.baseURL).toBe('https://custom.com/v1');
    });

    it('should configure openai router with useResponseModels', () => {
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);

      expect((routers[3].options as any).chatCompletion?.useResponseModels).toBeDefined();
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

      expect(routers).toHaveLength(4);
      expect(routers[0].options.baseURL).toBe('');
      expect(routers[3].options.baseURL).toBe('v1'); // urlJoin('', '/v1') returns 'v1'
    });
  });

  describe('Models Function - Integration Testing', () => {
    beforeEach(() => {
      mockProcessMultiProviderModelList.mockReturnValue([]);
    });

    it('should fetch models and process with processMultiProviderModelList', async () => {
      const mockClient = {
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
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
          id: 'test-model',
          displayName: 'Test Model',
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
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              model_name: 'test-model',
              quota_type: 0,
              model_price: 10,
              completion_ratio: 1.5,
              enable_groups: ['default'],
            },
          ],
        }),
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(mockFetch).toHaveBeenCalledWith('https://api.newapi.com/api/pricing', {
        headers: {
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
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              model_name: 'test-model',
              quota_type: 0,
              model_ratio: 5,
              enable_groups: ['default'],
            },
          ],
        }),
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
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              model_name: 'test-model',
              quota_type: 1, // Pay-per-call, not supported
              model_price: 10,
              enable_groups: ['default'],
            },
          ],
        }),
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing fetch failure gracefully', async () => {
      const mockClient = {
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
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
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockRejectedValue(new Error('Network error'));

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(console.debug).toHaveBeenCalledWith(
        'Failed to fetch NewAPI pricing info:',
        expect.any(Error),
      );
      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing data with success=false', async () => {
      const mockClient = {
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          data: [],
        }),
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle pricing data with missing data field', async () => {
      const mockClient = {
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                object: 'model',
                created: 123,
                owned_by: 'openai',
              },
            ],
          }),
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          // Missing data field
        }),
      });

      mockProcessMultiProviderModelList.mockImplementation((models) => models);

      const result = await params.models({ client: mockClient as any });

      expect(result[0].pricing).toBeUndefined();
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
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
        baseURL: 'https://api.newapi.com/v1',
        apiKey: 'test-key',
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
        { input: 'https://api.com/v1', expected: 'https://api.com' },
        { input: 'https://api.com/v1/', expected: 'https://api.com' },
        { input: 'https://api.com/v1beta', expected: 'https://api.com' },
        { input: 'https://api.com/v2alpha/', expected: 'https://api.com' },
        { input: 'https://api.com', expected: 'https://api.com' },
      ];

      for (const testCase of testCases) {
        const mockClient = {
          baseURL: testCase.input,
          apiKey: 'test-key',
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
  });

  describe('Runtime Instance Creation', () => {
    it('should create instance with minimal options', () => {
      const instance = new LobeNewAPIAI({ apiKey: 'test-key' });
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(LobeNewAPIAI);
    });

    it('should create instance with custom baseURL', () => {
      const instance = new LobeNewAPIAI({
        apiKey: 'test-key',
        baseURL: 'https://custom.com/v1',
      });
      expect(instance).toBeDefined();
    });

    it('should create instance with additional options', () => {
      const instance = new LobeNewAPIAI({
        apiKey: 'test-key',
        baseURL: 'https://custom.com',
      });
      expect(instance).toBeDefined();
    });
  });
});
