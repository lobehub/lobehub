import * as runtimeModule from '@lobechat/model-runtime';
import type { AIImageModelCard, EnabledAiModel, ModelParamsSchema, Pricing } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getChatModelList,
  getEmbeddingModelList,
  getImageModelList,
  normalizeChatModel,
  normalizeEmbeddingModel,
  normalizeImageModel,
} from '../action';

const createChatModel = (overrides: Partial<EnabledAiModel> = {}): EnabledAiModel => ({
  abilities: overrides.abilities ?? { functionCall: true },
  contextWindowTokens: overrides.contextWindowTokens ?? 8192,
  displayName: overrides.displayName ?? 'Chat Model',
  enabled: overrides.enabled ?? true,
  id: overrides.id ?? 'chat-model',
  providerId: overrides.providerId ?? 'openai',
  type: 'chat',
  ...overrides,
});

const createEmbeddingModel = (overrides: Partial<EnabledAiModel> = {}): EnabledAiModel => ({
  abilities: overrides.abilities ?? {},
  contextWindowTokens: overrides.contextWindowTokens,
  displayName: overrides.displayName ?? 'Embedding Model',
  enabled: overrides.enabled ?? true,
  id: overrides.id ?? 'embedding-model',
  providerId: overrides.providerId ?? 'openai',
  type: 'embedding',
  ...overrides,
});

type ImageEnabledModel = EnabledAiModel & AIImageModelCard;

const createImageModel = (overrides: Partial<ImageEnabledModel> = {}): ImageEnabledModel => ({
  abilities: overrides.abilities ?? {},
  contextWindowTokens: overrides.contextWindowTokens,
  displayName: overrides.displayName ?? 'Image Model',
  enabled: overrides.enabled ?? true,
  id: overrides.id ?? 'image-model',
  providerId: overrides.providerId ?? 'openai',
  type: 'image',
  ...overrides,
});

describe('aiProvider action helpers', () => {
  beforeEach(() => {
    vi.spyOn(runtimeModule, 'getModelPropertyWithFallback').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeChatModel', () => {
    it('fills missing optional fields with safe defaults', async () => {
      const model = createChatModel({
        abilities: undefined,
        contextWindowTokens: undefined,
        displayName: undefined,
      });

      const result = await normalizeChatModel(model);

      expect(result).toEqual({
        abilities: {},
        contextWindowTokens: undefined,
        displayName: '',
        id: 'chat-model',
      });
    });

    it('preserves inline metadata without loading fallback model config', async () => {
      const fallbackSpy = vi.spyOn(runtimeModule, 'getModelPropertyWithFallback');
      const pricing: Pricing = {
        units: [{ name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' }],
      };
      const model = {
        ...createChatModel({ id: 'online-chat-model', providerId: 'lobehub' }),
        description: 'Inline description',
        knowledgeCutoff: '2024-06',
        pricing,
      };

      const result = await normalizeChatModel(model);

      expect(result.description).toBe('Inline description');
      expect(result.knowledgeCutoff).toBe('2024-06');
      expect(result.pricing).toBe(pricing);
      expect(fallbackSpy).not.toHaveBeenCalled();
    });

    it('fetches fallback model knowledge cutoff when missing', async () => {
      const fallbackSpy = vi
        .mocked(runtimeModule.getModelPropertyWithFallback)
        .mockImplementation(async (_id, key) => {
          if (key === 'knowledgeCutoff') return '2024-06';
          return undefined;
        });

      const result = await normalizeChatModel(createChatModel({ id: 'gpt-4o' }));

      expect(result.knowledgeCutoff).toBe('2024-06');
      expect(fallbackSpy).toHaveBeenCalledWith('gpt-4o', 'knowledgeCutoff', 'openai');
    });
  });

  describe('normalizeImageModel', () => {
    it('preserves inline metadata and pricing information', async () => {
      const model = createImageModel({
        abilities: { vision: true },
        contextWindowTokens: 4096,
        displayName: 'Inline Model',
        parameters: {
          prompt: { default: '' },
          size: { default: '1024x1024', enum: ['512x512', '1024x1024'] },
        } as ModelParamsSchema,
        pricing: {
          units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
        },
      });

      const result = await normalizeImageModel(model);

      expect(result).toMatchObject({
        abilities: { vision: true },
        displayName: 'Inline Model',
        parameters: { size: { default: '1024x1024', enum: ['512x512', '1024x1024'] } },
        pricing: {
          units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
        },
      });
    });

    it('fetches fallback description/parameters/pricing when missing', async () => {
      const fallbackSpy = vi
        .mocked(runtimeModule.getModelPropertyWithFallback)
        .mockImplementation(async (_id, key) => {
          if (key === 'parameters')
            return {
              prompt: { default: '' },
              size: { default: '768x768', enum: ['512x512', '768x768'] },
            } satisfies ModelParamsSchema;
          if (key === 'pricing')
            return {
              units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
            };
          if (key === 'description') return 'Fallback description';
          return undefined;
        });

      const model = createImageModel({
        id: 'stable-diffusion',
        providerId: 'stability',
        parameters: undefined,
        pricing: undefined,
      });

      const result = await normalizeImageModel(model);

      expect(result.parameters).toEqual({
        prompt: { default: '' },
        size: { default: '768x768', enum: ['512x512', '768x768'] },
      });
      expect(result.pricing).toEqual({
        units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
      });
      expect(result.description).toBe('Fallback description');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'parameters', 'stability');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'pricing', 'stability');
      expect(fallbackSpy).toHaveBeenCalledWith('stable-diffusion', 'description', 'stability');
    });

    it('falls back to model config when parameters is an empty object', async () => {
      // Regression for #15493: the `parameters` DB column defaults to `{}`, which
      // must be treated as missing so required fields (e.g. `prompt`) are restored
      // from the bundled model config instead of failing schema validation.
      const fallbackSpy = vi
        .mocked(runtimeModule.getModelPropertyWithFallback)
        .mockImplementation(async (_id, key) => {
          if (key === 'parameters')
            return {
              prompt: { default: '' },
              size: { default: '1024x1024', enum: ['512x512', '1024x1024'] },
            } satisfies ModelParamsSchema;
          return undefined;
        });

      const model = createImageModel({
        id: 'cogview-4',
        parameters: {} as ModelParamsSchema,
        providerId: 'zhipu',
      });

      const result = await normalizeImageModel(model);

      expect(result.parameters).toEqual({
        prompt: { default: '' },
        size: { default: '1024x1024', enum: ['512x512', '1024x1024'] },
      });
      expect(fallbackSpy).toHaveBeenCalledWith('cogview-4', 'parameters', 'zhipu');
    });
  });

  describe('normalizeEmbeddingModel', () => {
    it('preserves inline embedding metadata without loading fallback model config', async () => {
      const fallbackSpy = vi.spyOn(runtimeModule, 'getModelPropertyWithFallback');
      const pricing: Pricing = {
        units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
      };
      const model = {
        ...createEmbeddingModel({ id: 'text-embedding-3-small', providerId: 'openai' }),
        description: 'Inline embedding description',
        knowledgeCutoff: '2024-01',
        pricing,
      };

      const result = await normalizeEmbeddingModel(model);

      expect(result.description).toBe('Inline embedding description');
      expect(result.knowledgeCutoff).toBe('2024-01');
      expect(result.pricing).toBe(pricing);
      expect(fallbackSpy).not.toHaveBeenCalled();
    });
  });

  describe('getChatModelList', () => {
    const chatModels = [
      createChatModel({ id: 'gpt-4', providerId: 'openai', displayName: 'GPT-4' }),
      createChatModel({ id: 'gpt-3.5', providerId: 'openai', displayName: 'GPT-3.5' }),
      createChatModel({ id: 'claude-3', providerId: 'anthropic', displayName: 'Claude 3' }),
    ];

    it('filters by provider and deduplicates IDs', async () => {
      const duplicated = [
        ...chatModels,
        createChatModel({ id: 'gpt-4', providerId: 'openai', displayName: 'GPT-4 Duplicate' }),
      ];

      const result = await getChatModelList(duplicated, 'openai');

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['gpt-4', 'gpt-3.5']);
      expect(result[0].displayName).toBe('GPT-4');
    });

    it('returns empty array when provider has no chat models', async () => {
      const result = await getChatModelList(chatModels, 'nonexistent');
      expect(result).toEqual([]);
    });

    it('filters runtime-only hidden models from visible chat lists', async () => {
      const result = await getChatModelList(
        [
          createChatModel({
            displayName: 'Visible Model',
            id: 'visible-model',
            providerId: 'lobehub',
          }),
          createChatModel({
            displayName: 'Onboarding Alias',
            id: 'lobehub-onboarding-v1',
            providerId: 'lobehub',
            visible: false,
          }),
        ],
        'lobehub',
      );

      expect(result.map((model) => model.id)).toEqual(['visible-model']);
    });
  });

  describe('getEmbeddingModelList', () => {
    it('collects only visible embedding models for a provider', async () => {
      // ROOT CAUSE:
      //
      // Memory embedding settings used the chat-only model list, so embedding
      // models existed in runtime state but were never offered by the selector.
      //
      // We fixed this by building an embedding-specific provider model list and
      // wiring the memory embedding dropdown to that list.
      const result = await getEmbeddingModelList(
        [
          createChatModel({ id: 'gpt-4o', providerId: 'openai' }),
          createEmbeddingModel({
            displayName: 'Text Embedding 3 Small',
            id: 'text-embedding-3-small',
            providerId: 'openai',
          }),
          createEmbeddingModel({
            displayName: 'Hidden Embedding Alias',
            id: 'hidden-embedding-alias',
            providerId: 'openai',
            visible: false,
          }),
          createEmbeddingModel({ id: 'cohere-embed', providerId: 'cohere' }),
        ],
        'openai',
      );

      expect(result.map((model) => model.id)).toEqual(['text-embedding-3-small']);
      expect(result[0].displayName).toBe('Text Embedding 3 Small');
    });
  });

  describe('getImageModelList', () => {
    const imageModels = [
      createImageModel({ id: 'dall-e-3', providerId: 'openai', displayName: 'DALL-E 3' }),
      createImageModel({ id: 'midjourney', providerId: 'midjourney', displayName: 'Midjourney' }),
    ];

    it('collects normalized image models for a provider', async () => {
      const result = await getImageModelList(imageModels, 'openai');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('dall-e-3');
      expect(result[0].displayName).toBe('DALL-E 3');
    });

    it('returns empty array when provider has no image models', async () => {
      const result = await getImageModelList(imageModels, 'unknown');
      expect(result).toEqual([]);
    });
  });
});
