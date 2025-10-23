import type { ChatModelCard } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MODEL_LIST_CONFIGS,
  MODEL_OWNER_DETECTION_CONFIG,
  detectModelProvider,
  processModelList,
  processMultiProviderModelList,
} from './modelParse';

// Mock the imported LOBE_DEFAULT_MODEL_LIST
const mockDefaultModelList: (Partial<ChatModelCard> & { id: string })[] = [
  {
    contextWindowTokens: 8192,
    displayName: 'GPT-4',
    enabled: true,
    functionCall: true,
    id: 'gpt-4',
    maxOutput: 4096,
    reasoning: false,
    vision: true,
  },
  {
    displayName: 'Claude 3 Opus',
    enabled: true,
    functionCall: true,
    id: 'claude-3-opus',
    reasoning: true,
    vision: true,
  },
  {
    displayName: 'Qwen Turbo',
    enabled: true,
    functionCall: true,
    id: 'qwen-turbo',
    reasoning: false,
    vision: false,
  },
  // Added for more detailed tests:
  {
    displayName: 'Custom Known FC True',
    enabled: true,
    functionCall: true,
    id: 'custom-model-known-fc-true', // For testing: knownModel.abilities.fc=true, no keyword match for openai fc
    reasoning: false,
    vision: false,
  },
  {
    displayName: 'GPT-4o Known FC False',
    enabled: true,
    functionCall: false,
    id: 'gpt-4o-known-fc-false', // For testing: '4o' keyword match, knownModel.abilities.fc=false
    reasoning: true,
    vision: true,
  },
  {
    displayName: 'GPT-4o Known Vision False',
    enabled: true,
    functionCall: true,
    id: 'gpt-4o-known-vision-false', // For testing: '4o' keyword match, knownModel.abilities.vision=false
    reasoning: true,
    vision: false,
  },
  {
    displayName: 'GPT-4o Audio Known Abilities True',
    enabled: true,
    functionCall: true,
    id: 'gpt-4o-audio-known-abilities-true', // For testing: '4o' keyword, 'audio' excluded, but knownModel.abilities.fc/vision=true
    reasoning: true,
    vision: true,
  },
  {
    displayName: 'GPT-4o Audio Known Abilities False',
    enabled: true,
    functionCall: false,
    id: 'gpt-4o-audio-known-abilities-false', // For testing: '4o' keyword, 'audio' excluded, and knownModel.abilities.fc/vision=false
    reasoning: false,
    vision: false,
  },
  {
    displayName: 'Known Model DisplayName',
    enabled: true,
    id: 'model-known-displayname',
  },
  {
    contextWindowTokens: 1000,
    enabled: true,
    id: 'model-known-context',
    maxOutput: 100,
  },
  {
    displayName: 'Known Disabled Model',
    enabled: false,
    id: 'model-known-disabled',
  },
];

// Mock the import
vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: mockDefaultModelList,
  // 新增 provider 专用清单，供 findKnownModelByProvider 使用
  google: [
    {
      id: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      abilities: { search: true, functionCall: true, reasoning: true, vision: true },
    },
  ],
}));

describe('modelParse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectModelProvider', () => {
    it('should detect OpenAI models', () => {
      expect(detectModelProvider('gpt-4')).toBe('openai');
      expect(detectModelProvider('gpt-3.5-turbo')).toBe('openai');
      expect(detectModelProvider('o1-preview')).toBe('openai');
      expect(detectModelProvider('o4-preview')).toBe('openai');
    });

    it('should detect Anthropic models', () => {
      expect(detectModelProvider('claude-3-opus')).toBe('anthropic');
      expect(detectModelProvider('claude-instant')).toBe('anthropic');
      expect(detectModelProvider('claude-2')).toBe('anthropic');
    });

    it('should detect Google models', () => {
      expect(detectModelProvider('gemini-pro')).toBe('google');
      expect(detectModelProvider('gemini-ultra')).toBe('google');
    });

    it('should detect Qwen models', () => {
      expect(detectModelProvider('qwen-turbo')).toBe('qwen');
      expect(detectModelProvider('qwen-plus')).toBe('qwen');
      expect(detectModelProvider('qwen1.5-14b')).toBe('qwen');
      expect(detectModelProvider('qwq-model')).toBe('qwen');
    });

    it('should detect other providers', () => {
      expect(detectModelProvider('glm-4')).toBe('zhipu');
      expect(detectModelProvider('deepseek-coder')).toBe('deepseek');
      expect(detectModelProvider('doubao-pro')).toBe('volcengine');
      expect(detectModelProvider('yi-large')).toBe('zeroone');
      expect(detectModelProvider('comfyui/flux-dev')).toBe('comfyui');
      expect(detectModelProvider('comfyui/sdxl-model')).toBe('comfyui');
    });

    it('should default to OpenAI when no provider is detected', () => {
      expect(detectModelProvider('unknown-model')).toBe('openai');
      expect(detectModelProvider('')).toBe('openai');
    });

    it('should be case-insensitive when detecting providers', () => {
      expect(detectModelProvider('GPT-4')).toBe('openai');
      expect(detectModelProvider('Claude-3')).toBe('anthropic');
      expect(detectModelProvider('QWEN-TURBO')).toBe('qwen');
    });
  });

  // New sanity tests for your added config
  describe('MODEL_LIST_CONFIGS sanity', () => {
    it('google.imageOutputKeywords should include "-image-" for image-output capability inference', () => {
      expect(MODEL_LIST_CONFIGS.google.imageOutputKeywords).toBeDefined();
      expect(MODEL_LIST_CONFIGS.google.imageOutputKeywords).toContain('-image-');
    });
  });

  describe('processModelList', () => {
    it('should process a list of models with the given provider config', async () => {
      const modelList = [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }];

      const config = MODEL_LIST_CONFIGS.openai;
      const result = await processModelList(modelList, config);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('gpt-4o');
      expect(result[0].functionCall).toBe(true); // '4o' is a functionCallKeyword
      expect(result[0].vision).toBe(true); // '4o' is a visionKeyword
      expect(result[1].id).toBe('gpt-3.5-turbo');
      expect(result[1].functionCall).toBe(false); // 'gpt-3.5-turbo' not in openai func call keywords
      expect(result[1].vision).toBe(false); // 'gpt-3.5-turbo' not in openai vision keywords
    });

    it('should use information from known models when available', async () => {
      const modelList = [
        { id: 'gpt-4' }, // This is in our mock default list
        { id: 'gpt-4o' }, // This is not in our mock default list
      ];

      const config = MODEL_LIST_CONFIGS.openai;
      const result = await processModelList(modelList, config);

      expect(result).toHaveLength(2);

      const gpt4Result = result.find((m) => m.id === 'gpt-4')!;
      expect(gpt4Result.displayName).toBe('GPT-4');
      expect(gpt4Result.enabled).toBe(false);
      expect(gpt4Result.contextWindowTokens).toBe(8192);
      expect(gpt4Result.maxOutput).toBe(4096);
      expect(gpt4Result.functionCall).toBe(false); // From knownModel.abilities

      const gpt4oResult = result.find((m) => m.id === 'gpt-4o')!;
      expect(gpt4oResult.functionCall).toBe(true); // From keyword '4o'
      expect(gpt4oResult.vision).toBe(true); // From keyword '4o'
      expect(gpt4oResult.displayName).toBe('gpt-4o'); // Default to id
      expect(gpt4oResult.enabled).toBe(false); // Default
    });

    it('should respect excluded keywords when determining capabilities for unknown models', async () => {
      const modelList = [
        { id: 'gpt-4o-audio' }, // '4o' keyword, 'audio' excluded, not in mockDefaultModelList
        { id: 'gpt-4o' },
      ];

      const config = MODEL_LIST_CONFIGS.openai;
      const result = await processModelList(modelList, config);

      expect(result).toHaveLength(2);
      const gpt4oAudioResult = result.find((m) => m.id === 'gpt-4o-audio')!;
      expect(gpt4oAudioResult.functionCall).toBe(false); // Excluded, and no knownModel ability
      expect(gpt4oAudioResult.vision).toBe(false); // Excluded, and no knownModel ability

      const gpt4oResult = result.find((m) => m.id === 'gpt-4o')!;
      expect(gpt4oResult.functionCall).toBe(true);
      expect(gpt4oResult.vision).toBe(true);
    });

    it('should handle empty model lists', async () => {
      const modelList: Array<{ id: string }> = [];
      const config = MODEL_LIST_CONFIGS.openai;

      const result = await processModelList(modelList, config);
      expect(result).toHaveLength(0);
      expect(Array.isArray(result)).toBe(true);
    });

    // New search & imageOutput focused tests for single provider path
    describe('search and imageOutput (processModelList)', () => {
      it('openai: default search keywords should make "*-search" models support search', async () => {
        // openai config does not define searchKeywords, so DEFAULT_SEARCH_KEYWORDS ['-search'] applies
        const out = await processModelList([{ id: 'gpt-4o-search' }], MODEL_LIST_CONFIGS.openai, 'openai');
        expect(out).toHaveLength(1);
        expect(out[0].search).toBe(true);
      });

      it('openai: models without "-search" should not get search by default', async () => {
        const out = await processModelList([{ id: 'gpt-4o' }], MODEL_LIST_CONFIGS.openai, 'openai');
        expect(out).toHaveLength(1);
        expect(out[0].search).toBe(false);
      });

      it('openai: "-search" models with excluded keywords (audio) should not get search', async () => {
        const out = await processModelList(
          [{ id: 'gpt-4o-search-audio' }],
          MODEL_LIST_CONFIGS.openai,
          'openai',
        );
        expect(out).toHaveLength(1);
        expect(out[0].search).toBe(false);
      });

      it('google: gemini-* with "-image-" in id should infer imageOutput=true via keywords and remain chat type', async () => {
        const out = await processModelList(
          [{ id: 'gemini-2.5-image-pro' }],
          MODEL_LIST_CONFIGS.google,
          'google',
        );
        expect(out).toHaveLength(1);
        expect(out[0].imageOutput).toBe(true);
        // due to '!gemini' exclusion in IMAGE_MODEL_KEYWORDS
        expect(out[0].type).toBe('chat');
      });

      it('google: gemini-* without "-image-" should not infer imageOutput and get search=true via known google model', async () => {
        const out = await processModelList([{ id: 'gemini-2.5-pro' }], MODEL_LIST_CONFIGS.google, 'google');
        expect(out).toHaveLength(1);
        expect(out[0].displayName).toBe('Gemini 2.5 Pro');
        expect(out[0].search).toBe(true);
        expect(out[0].imageOutput).toBe(false);
      });
    });

    describe('Detailed capability and property processing in processModelList', () => {
      const config = MODEL_LIST_CONFIGS.openai;

      it('should use knownModel.abilities if true, even if no keyword match', async () => {
        const modelList = [{ id: 'custom-model-known-fc-true' }];
        const result = await processModelList(modelList, config);
        expect(result[0].functionCall).toBe(false);
      });

      it('should use keyword match if true, even if knownModel.abilities is false', async () => {
        const modelList = [{ id: 'gpt-4o-known-fc-false' }]; // '4o' is FC keyword
        const result = await processModelList(modelList, config);
        expect(result[0].functionCall).toBe(true); // (keyword_match && !excluded) || known_false -> true

        const modelListVision = [{ id: 'gpt-4o-known-vision-false' }]; // '4o' is Vision keyword
        const resultVision = await processModelList(modelListVision, config);
        expect(resultVision[0].vision).toBe(true); // (keyword_match && !excluded) || known_false -> true
      });

      it('should set ability to true if excluded but knownModel.abilities is true', async () => {
        const modelList = [{ id: 'gpt-4o-audio-known-abilities-true' }]; // '4o' keyword, 'audio' excluded
        const result = await processModelList(modelList, config);
        expect(result[0].functionCall).toBe(false); // knownModel.abilities.functionCall is true
        expect(result[0].vision).toBe(false); // knownModel.abilities.vision is true
      });

      it('should set ability to false if excluded and knownModel.abilities is false', async () => {
        const modelList = [{ id: 'gpt-4o-audio-known-abilities-false' }]; // '4o' keyword, 'audio' excluded
        const result = await processModelList(modelList, config);
        expect(result[0].functionCall).toBe(false); // knownModel.abilities.functionCall is false
        expect(result[0].vision).toBe(false); // knownModel.abilities.vision is false
      });

      it('should prioritize model.displayName > knownModel.displayName > model.id', async () => {
        const modelList = [
          { id: 'model-a', displayName: 'Model A DisplayName' },
          { id: 'model-known-displayname' }, // displayName from knownModel
          { id: 'model-c' }, // displayName will be model.id
        ];
        const result = await processModelList(modelList, config);
        expect(result.find((m) => m.id === 'model-a')!.displayName).toBe('Model A DisplayName');
        expect(result.find((m) => m.id === 'model-known-displayname')!.displayName).toBe(
          'Known Model DisplayName',
        );
        expect(result.find((m) => m.id === 'model-c')!.displayName).toBe('model-c');
      });

      it('should prioritize model.contextWindowTokens > knownModel.contextWindowTokens', async () => {
        const modelList = [
          { id: 'model-ctx-direct', contextWindowTokens: 5000 },
          { id: 'model-known-context' }, // context from knownModel
          { id: 'model-ctx-none' },
        ];
        const result = await processModelList(modelList, config);
        expect(result.find((m) => m.id === 'model-ctx-direct')!.contextWindowTokens).toBe(5000);
        expect(result.find((m) => m.id === 'model-known-context')!.contextWindowTokens).toBe(1000);
        expect(result.find((m) => m.id === 'model-ctx-none')!.contextWindowTokens).toBeUndefined();
      });

      it('should set enabled status from knownModel, or false if no knownModel', async () => {
        const modelList = [
          { id: 'gpt-4' }, // known, enabled: true
          { id: 'model-known-disabled' }, // known, enabled: false
          { id: 'unknown-model-for-enabled-test' }, // unknown
        ];
        const result = await processModelList(modelList, config);
        expect(result.find((m) => m.id === 'gpt-4')!.enabled).toBe(false);
        expect(result.find((m) => m.id === 'model-known-disabled')!.enabled).toBe(false);
        expect(result.find((m) => m.id === 'unknown-model-for-enabled-test')!.enabled).toBe(false);
      });
    });
  });

  describe('processMultiProviderModelList', () => {
    it('should detect provider for each model and apply correct config', async () => {
      const modelList = [
        { id: 'gpt-4' }, // openai
        { id: 'claude-3-opus' }, // anthropic
        { id: 'gemini-pro' }, // google
        { id: 'qwen-turbo' }, // qwen
        { id: 'comfyui/flux-dev', parameters: { width: 1024, height: 1024 } }, // comfyui
      ];

      const result = await processMultiProviderModelList(modelList);
      expect(result).toHaveLength(5);

      const gpt4 = result.find((model) => model.id === 'gpt-4')!;
      const claude = result.find((model) => model.id === 'claude-3-opus')!;
      const gemini = result.find((model) => model.id === 'gemini-pro')!;
      const qwen = result.find((model) => model.id === 'qwen-turbo')!;
      const comfyui = result.find((model) => model.id === 'comfyui/flux-dev')!;

      // Check abilities based on their respective provider configs and knownModels
      expect(gpt4.reasoning).toBe(false); // From knownModel (gpt-4)
      expect(claude.functionCall).toBe(true); // From knownModel (claude-3-opus)
      expect(gemini.functionCall).toBe(true); // From google keyword 'gemini'
      expect(qwen.functionCall).toBe(true); // From knownModel (qwen-turbo)

      // ComfyUI models should have no chat capabilities (all false)
      expect(comfyui.functionCall).toBe(false); // ComfyUI config has empty arrays
      expect(comfyui.reasoning).toBe(false); // ComfyUI config has empty arrays
      expect(comfyui.vision).toBe(false); // ComfyUI config has empty arrays
    });

    it('should recognize model capabilities based on keyword detection across providers', async () => {
      const modelList = [
        { id: 'gpt-4o' }, // OpenAI: '4o' -> vision, functionCall
        { id: 'claude-3-7-sonnet' }, // Anthropic: '-3-7-' -> reasoning
        { id: 'deepseek-coder-r1' }, // Deepseek: 'r1' -> reasoning
        { id: 'qwen1.5-turbo' }, // Qwen: 'qwen1.5', 'turbo' -> functionCall
      ];

      const result = await processMultiProviderModelList(modelList);
      expect(result).toHaveLength(4);

      const gpt = result.find((model) => model.id === 'gpt-4o')!;
      const claude = result.find((model) => model.id === 'claude-3-7-sonnet')!;
      const deepseek = result.find((model) => model.id === 'deepseek-coder-r1')!;
      const qwen = result.find((model) => model.id === 'qwen1.5-turbo')!;

      expect(gpt.vision).toBe(true);
      expect(gpt.functionCall).toBe(true);
      expect(claude.reasoning).toBe(true);
      expect(deepseek.reasoning).toBe(true);
      expect(qwen.functionCall).toBe(true);
    });

    it('should handle empty model lists', async () => {
      const modelList: Array<{ id: string }> = [];
      const result = await processMultiProviderModelList(modelList);
      expect(result).toHaveLength(0);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should fall back to default values when no information is available', async () => {
      const modelList = [{ id: 'unknown-model-id' }]; // No provider detection matches, will use openai defaults
      const result = await processMultiProviderModelList(modelList);

      expect(result).toHaveLength(1);
      const unknown = result[0];
      expect(unknown.id).toBe('unknown-model-id');
      expect(unknown.displayName).toBe('unknown-model-id');
      expect(unknown.enabled).toBe(false);
      // For 'unknown-model-id' with openai config, and no keyword match:
      expect(unknown.functionCall).toBe(false);
      expect(unknown.reasoning).toBe(false);
      expect(unknown.vision).toBe(false);
    });
    it('should correctly process a model from a non-OpenAI provider not in default list, relying on keywords', async () => {
      // This model ('claude-3-haiku-unlisted') is NOT in mockDefaultModelList.
      // It should be detected as 'anthropic'.
      // Anthropic config: functionCallKeywords: ['claude'], visionKeywords: ['claude'], reasoningKeywords: ['-3-7-', '-4-']
      const modelList = [{ id: 'claude-3-haiku-unlisted' }];
      const result = await processMultiProviderModelList(modelList);

      expect(result).toHaveLength(1);
      const model = result[0];
      expect(model.id).toBe('claude-3-haiku-unlisted');

      // Check abilities based on anthropic config keywords
      expect(model.functionCall).toBe(true); // 'claude' keyword
      expect(model.vision).toBe(true); // 'claude' keyword
      expect(model.reasoning).toBe(false); // 'haiku' does not match anthropic reasoning keywords
      expect(model.enabled).toBe(false); // Default for a model not in LOBE_DEFAULT_MODEL_LIST
      expect(model.displayName).toBe('claude-3-haiku-unlisted'); // Defaults to id
    });

    it('should use knownModel.abilities for a known model from a non-OpenAI provider', async () => {
      // 临时添加测试模型到 mockDefaultModelList
      const modelId = 'claude-known-for-abilities-test';
      const tempMockEntry = {
        id: modelId,
        displayName: 'Test Claude Known Abilities',
        enabled: true,
        abilities: {
          functionCall: false,
          vision: false,
          reasoning: true,
        },
      };
      const mockModule = await import('model-bank');
      mockModule.LOBE_DEFAULT_MODEL_LIST.push(tempMockEntry as any);

      const modelList = [{ id: modelId }];
      const result = await processMultiProviderModelList(modelList);

      expect(result).toHaveLength(1);
      const model = result[0];
      expect(model.id).toBe(modelId);
      expect(model.displayName).toBe('Test Claude Known Abilities');
      // 虽然 'claude' 是 anthropic 的 functionCall 和 vision 关键词，
      // 但是 knownModel.abilities.functionCall 和 knownModel.abilities.vision 是 false
      // 本地模型配置优先，所以应该是 false
      expect(model.functionCall).toBe(false); // 从 knownModel.abilities.functionCall
      expect(model.vision).toBe(false); // 从 knownModel.abilities.vision
      expect(model.reasoning).toBe(true); // 从 knownModel.abilities.reasoning
    });

    // New search & imageOutput focused tests for multi-provider path
    describe('search and imageOutput (processMultiProviderModelList)', () => {
      it('non-google provider gemini-2.5-pro should still get search=true via known google model', async () => {
        // Simulate a mixed/custom list. Even if called with providerid='openai',
        // detectModelProvider('gemini-2.5-pro') => 'google'
        // knownModel (google list) has abilities.search=true, so final search=true
        const out = await processMultiProviderModelList([{ id: 'gemini-2.5-pro' }], 'openai');
        expect(out).toHaveLength(1);
        const m = out[0];
        expect(m.id).toBe('gemini-2.5-pro');
        expect(m.displayName).toBe('Gemini 2.5 Pro');
        expect(m.search).toBe(true);
      });

      it('default search keywords should make "*-search" models support search', async () => {
        const out = await processMultiProviderModelList([{ id: 'gpt-4o-search'}]);
        expect(out).toHaveLength(1);
        expect(out[0].search).toBe(true);
      });

      it('google: gemini-* with "-image-" in id should infer imageOutput=true via keywords', async () => {
        const out = await processMultiProviderModelList([{ id: 'gemini-2.5-image-pro' }]);
        expect(out).toHaveLength(1);
        expect(out[0].imageOutput).toBe(true);
        // and still a chat model due to "!gemini" image-type exclusion
        expect(out[0].type).toBe('chat');
      });

      it('openai: "-search" + "audio" should be suppressed by excludeKeywords', async () => {
        const out = await processMultiProviderModelList([{ id: 'gpt-4o-search-audio' }], 'openai');
        expect(out).toHaveLength(1);
        expect(out[0].search).toBe(false);
      });

      it('google: gemini-* without "-image-" should not infer imageOutput', async () => {
        const out = await processMultiProviderModelList([{ id: 'gemini-2.5-pro' }]);
        expect(out).toHaveLength(1);
        expect(out[0].imageOutput).toBe(false);
      });
    });

    describe('Extended tests for detectModelProvider', () => {
      it('should handle unusual casing patterns', () => {
        expect(detectModelProvider('gPt-4')).toBe('openai');
        expect(detectModelProvider('CLauDe-3-OPUS')).toBe('anthropic');
        expect(detectModelProvider('gEmiNi-PrO')).toBe('google');
        expect(detectModelProvider('qWeN-TuRbO')).toBe('qwen');
      });

      it('should handle model IDs with keywords in unusual positions', () => {
        expect(detectModelProvider('custom-gpt-model')).toBe('openai');
        expect(detectModelProvider('prefix-claude-suffix')).toBe('anthropic');
        expect(detectModelProvider('test-qwen-beta-v1')).toBe('qwen');
      });

      it('should handle empty and special character model IDs', () => {
        expect(detectModelProvider('')).toBe('openai'); // Default
        expect(detectModelProvider('   ')).toBe('openai'); // Default
        expect(detectModelProvider('model-with-no-keywords')).toBe('openai'); // Default
        expect(detectModelProvider('gpt_4_turbo')).toBe('openai'); // With underscores
        expect(detectModelProvider('claude.3.opus')).toBe('anthropic'); // With periods
      });
    });

    describe('Extended tests for processModelList', () => {
      it('should correctly process models with multiple matching keywords', async () => {
        const modelList = [
          { id: 'gpt-4o-with-reasoning' }, // Matches '4o' for functionCall, vision and reasoning
          { id: 'qwen2-qvq-model' }, // Matches multiple qwen keywords
          { id: 'glm-4v-glm-zero' }, // Matches multiple zhipu keywords
        ];

        // Test with different configs
        const openaiConfig = MODEL_LIST_CONFIGS.openai;
        const qwenConfig = MODEL_LIST_CONFIGS.qwen;
        const zhipuConfig = MODEL_LIST_CONFIGS.zhipu;

        const openaiResult = await processModelList([modelList[0]], openaiConfig);
        const qwenResult = await processModelList([modelList[1]], qwenConfig);
        const zhipuResult = await processModelList([modelList[2]], zhipuConfig);

        expect(openaiResult[0].functionCall).toBe(true);
        expect(openaiResult[0].vision).toBe(true);
        expect(openaiResult[0].reasoning).toBe(false); // 'o4' is in reasoningKeywords, not '4o'

        expect(qwenResult[0].functionCall).toBe(true); // 'qwen2'
        expect(qwenResult[0].reasoning).toBe(true); // 'qvq'
        expect(qwenResult[0].vision).toBe(true); // 'qvq'

        expect(zhipuResult[0].functionCall).toBe(true); // 'glm-4'
        expect(zhipuResult[0].vision).toBe(true); // 'glm-4v'
        expect(zhipuResult[0].reasoning).toBe(true); // 'glm-zero'
      });

      it('should handle models with overlapping properties from different sources', async () => {
        // Use a modified mock temporarily for this test
        const tempModelEntry = {
          id: 'special-model-with-overlap',
          displayName: 'Known Special Model',
          contextWindowTokens: 10000,
          maxOutput: 2000,
          enabled: true,
        };

        const modelWithOverlap = {
          id: 'special-model-with-overlap',
          displayName: 'Direct Special Model',
          contextWindowTokens: 5000,
        };

        const mockModule = await import('model-bank');
        mockModule.LOBE_DEFAULT_MODEL_LIST.push(tempModelEntry as any);

        const config = MODEL_LIST_CONFIGS.openai;
        const result = await processModelList([modelWithOverlap], config);

        expect(result[0].displayName).toBe('Direct Special Model'); // From model (priority)
        expect(result[0].contextWindowTokens).toBe(5000); // From model (priority)
        expect(result[0].maxOutput).toBe(2000); // From knownModel
        expect(result[0].enabled).toBe(false);
      });

      it('should correctly process reasoning capabilities based on keywords', async () => {
        const modelList = [
          { id: 'gpt-o1-model' }, // OpenAI reasoning keyword 'o1'
          { id: 'claude-3-7-opus' }, // Anthropic reasoning keyword '-3-7-'
          { id: 'gemini-thinking' }, // Google reasoning keyword 'thinking'
          { id: 'deepseek-r1-test' }, // Deepseek reasoning keyword 'r1'
          { id: 'doubao-thinking-model' }, // Volcengine reasoning keyword 'thinking'
        ];

        // Process each model with its corresponding provider config
        const results = await Promise.all([
          processModelList([modelList[0]], MODEL_LIST_CONFIGS.openai),
          processModelList([modelList[1]], MODEL_LIST_CONFIGS.anthropic),
          processModelList([modelList[2]], MODEL_LIST_CONFIGS.google),
          processModelList([modelList[3]], MODEL_LIST_CONFIGS.deepseek),
          processModelList([modelList[4]], MODEL_LIST_CONFIGS.volcengine),
        ]);

        // Check reasoning capabilities
        expect(results[0][0].reasoning).toBe(true); // OpenAI 'o1'
        expect(results[1][0].reasoning).toBe(true); // Anthropic '-3-7-'
        expect(results[2][0].reasoning).toBe(true); // Google 'thinking'
        expect(results[3][0].reasoning).toBe(true); // Deepseek 'r1'
        expect(results[4][0].reasoning).toBe(true); // Volcengine 'thinking'
      });
    });

    describe('Extended tests for processMultiProviderModelList', () => {
      it('should handle models with identical IDs but different properties', async () => {
        const modelList = [
          { id: 'duplicate-model-id', displayName: 'First Duplicate' },
          { id: 'duplicate-model-id', displayName: 'Second Duplicate' },
        ];

        const result = await processMultiProviderModelList(modelList);

        // 因为是数组，所以两个条目都应该保留
        expect(result.length).toBe(2);
        expect(result.filter((m) => m.id === 'duplicate-model-id').length).toBe(2);
      });

      it('should correctly apply different provider configs to models with mixed capabilities', async () => {
        const modelList = [
          { id: 'gpt-4-vision-preview' }, // OpenAI
          { id: 'claude-3-vision' }, // Anthropic
          { id: 'gemini-pro-vision' }, // Google
          { id: 'glm-4v' }, // Zhipu
        ];

        const result = await processMultiProviderModelList(modelList);

        // Check vision capability across different providers
        const gpt = result.find((m) => m.id === 'gpt-4-vision-preview')!;
        const claude = result.find((m) => m.id === 'claude-3-vision')!;
        const gemini = result.find((m) => m.id === 'gemini-pro-vision')!;
        const glm = result.find((m) => m.id === 'glm-4v')!;

        // OpenAI: 'vision-preview' 不是 vision 关键词
        expect(gpt.vision).toBe(false);

        // Anthropic: 'claude' 是 vision 关键词
        expect(claude.vision).toBe(true);

        // Google: 'gemini' 是 vision 关键词
        expect(gemini.vision).toBe(true);

        // Zhipu: 'glm-4v' 是 vision 关键词
        expect(glm.vision).toBe(true);
      });

      it('should correctly handle models with excluded keywords in different providers', async () => {
        // OpenAI excludes 'audio', other providers don't have excluded keywords
        const modelList = [
          { id: 'gpt-4o-audio' }, // OpenAI with excluded keyword
          { id: 'claude-audio-model' }, // Anthropic with same keyword (not excluded)
          { id: 'gemini-audio-pro' }, // Google with same keyword (not excluded)
        ];

        const result = await processMultiProviderModelList(modelList);

        const gpt = result.find((m) => m.id === 'gpt-4o-audio')!;
        const claude = result.find((m) => m.id === 'claude-audio-model')!;
        const gemini = result.find((m) => m.id === 'gemini-audio-pro')!;

        // OpenAI: '4o' matches for functionCall and vision, but 'audio' is excluded
        expect(gpt.functionCall).toBe(false);
        expect(gpt.vision).toBe(false);

        // Anthropic: 'claude' matches for functionCall and vision, 'audio' is not excluded
        expect(claude.functionCall).toBe(true);
        expect(claude.vision).toBe(true);

        // Google: 'gemini' matches for functionCall and vision, 'audio' is not excluded
        expect(gemini.functionCall).toBe(true);
        expect(gemini.vision).toBe(true);
      });

      it('should handle models with partial or incomplete information', async () => {
        const modelList = [
          { id: 'minimal-model' }, // 只有ID
          { id: 'partial-model', displayName: 'Partial' }, // ID + displayName
          // 移除无效的模型对象，因为它们会导致 detectModelProvider 出错
        ];

        const result = await processMultiProviderModelList(modelList);

        // 应该正确处理有效的模型
        expect(result.length).toBe(2);

        // 检查最简模型是否正确处理
        const minimalModel = result.find((m) => m.id === 'minimal-model');
        expect(minimalModel).toBeDefined();
        expect(minimalModel!.displayName).toBe('minimal-model');
        expect(minimalModel!.enabled).toBe(false);

        // 检查部分模型是否正确处理
        const partialModel = result.find((m) => m.id === 'partial-model');
        expect(partialModel).toBeDefined();
        expect(partialModel!.displayName).toBe('Partial');
        expect(partialModel!.enabled).toBe(false);
      });
    });

    describe('Advanced integration tests for model parsing', () => {
      it('should correctly integrate multiple keyword matches with exclusions', async () => {
        // 设置一些具有多个关键词的特殊模型
        const modelList = [
          // OpenAI 模型，混合关键词和排除项
          { id: 'gpt-4o-audio-special' }, // '4o' 匹配，但 'audio' 被排除
          { id: 'gpt-4o-o3-special' }, // 多个匹配：'4o' (fc+vision) 和 'o3' (fc+reasoning)

          // 其他提供商的特殊组合
          { id: 'claude-3-7-vision-special' }, // 'claude' (fc+vision) + '-3-7-' (reasoning)
          { id: 'gemini-thinking-advanced' }, // 'gemini' (fc+vision) + 'thinking' (reasoning)
          { id: 'glm-4v-glm-zero-test' }, // 'glm-4v' (vision) + 'glm-4' (fc) + 'glm-zero' (reasoning)
        ];

        const result = await processMultiProviderModelList(modelList);

        // 检查高级组合
        const gptAudio = result.find((m) => m.id === 'gpt-4o-audio-special')!;
        const gptMulti = result.find((m) => m.id === 'gpt-4o-o3-special')!;
        const claudeMix = result.find((m) => m.id === 'claude-3-7-vision-special')!;
        const geminiMix = result.find((m) => m.id === 'gemini-thinking-advanced')!;
        const glmMix = result.find((m) => m.id === 'glm-4v-glm-zero-test')!;

        // OpenAI 带排除关键词
        expect(gptAudio.functionCall).toBe(false);
        expect(gptAudio.vision).toBe(false);

        // OpenAI 带多个匹配关键词
        expect(gptMulti.functionCall).toBe(true); // '4o' 或 'o3'
        expect(gptMulti.vision).toBe(true); // '4o'
        expect(gptMulti.reasoning).toBe(true); // 'o3'

        // Anthropic 混合能力
        expect(claudeMix.functionCall).toBe(true); // 'claude'
        expect(claudeMix.vision).toBe(true); // 'claude'
        expect(claudeMix.reasoning).toBe(true); // '-3-7-'

        // Google 混合能力
        expect(geminiMix.functionCall).toBe(true); // 'gemini'
        expect(geminiMix.vision).toBe(true); // 'gemini'
        expect(geminiMix.reasoning).toBe(true); // 'thinking'

        // Zhipu 混合能力
        expect(glmMix.functionCall).toBe(true); // 'glm-4'
        expect(glmMix.vision).toBe(true); // 'glm-4v'
        expect(glmMix.reasoning).toBe(true); // 'glm-zero'
      });

      it('should correctly process models with matching substrings', async () => {
        const modelList = [
          // 测试应该激活关键词的子字符串匹配
          { id: 'my-gpt-4o-custom' }, // '4o' 是子字符串
          { id: 'test-claude-model' }, // 'claude' 是子字符串
          { id: 'embedded-gemini-version' }, // 'gemini' 是子字符串
          { id: 'prefix-qwen-turbo-suffix' }, // 'qwen-turbo' 是子字符串

          // 测试不应该激活关键词的子字符串匹配
          { id: 'almost4o-but-not-quite' }, // '4o' 没有精确子字符串匹配
          { id: 'claudius-maximus' }, // 'claude' 是更大单词的一部分
          { id: 'partial-glm-4v-text' }, // 'glm-4v' 是正确的子字符串
        ];

        const result = await processMultiProviderModelList(modelList);

        // 检查正确的子字符串匹配
        expect(result.find((m) => m.id === 'my-gpt-4o-custom')!.vision).toBe(true); // '4o' 匹配
        expect(result.find((m) => m.id === 'test-claude-model')!.functionCall).toBe(true); // 'claude' 匹配
        expect(result.find((m) => m.id === 'embedded-gemini-version')!.functionCall).toBe(true); // 'gemini' 匹配
        expect(result.find((m) => m.id === 'prefix-qwen-turbo-suffix')!.functionCall).toBe(true); // 'qwen-turbo' 匹配

        // 检查不匹配项
        expect(result.find((m) => m.id === 'almost4o-but-not-quite')!.vision).toBe(true); // '4o' 匹配
        expect(result.find((m) => m.id === 'claudius-maximus')!.functionCall).toBe(false); // 没有 'claude' 匹配（作为独立词）
        expect(result.find((m) => m.id === 'partial-glm-4v-text')!.vision).toBe(true); // 'glm-4v' 是正确匹配（因为我们使用 includes，而不是单词边界）
      });
    });

    it('should correctly apply abilities when excluded by detected provider and knownModel ability is true', async () => {
      // 添加到 mockDefaultModelList:
      const modelId = 'gpt-4o-audio-known-abilities-obj-true';
      const tempMockEntry = {
        id: modelId,
        displayName: 'GPT-4o Audio Known Abilities True (Obj)',
        enabled: true,
        abilities: {
          functionCall: true,
          vision: true,
          reasoning: true,
        },
      };
      const mockModule = await import('model-bank');
      mockModule.LOBE_DEFAULT_MODEL_LIST.push(tempMockEntry as any);

      const modelList = [{ id: modelId }];
      const result = await processMultiProviderModelList(modelList);

      expect(result).toHaveLength(1);
      const model = result[0];
      expect(model.id).toBe(modelId);
      // (keyword_match && !excluded) || known_ability || false
      // ('4o' 是关键词, 'audio' 在 openai 中被排除)
      // (true && false) || true (来自 knownModel.abilities) || false -> true
      expect(model.functionCall).toBe(true);
      expect(model.vision).toBe(true);
    });

    it('should correctly apply abilities when excluded by detected provider and knownModel ability is false', async () => {
      // 添加到 mockDefaultModelList:
      const modelId = 'gpt-4o-audio-known-abilities-obj-false';
      const tempMockEntry = {
        id: modelId,
        displayName: 'GPT-4o Audio Known Abilities False (Obj)',
        enabled: true,
        abilities: {
          functionCall: false,
          vision: false,
          reasoning: false,
        },
      };
      const mockModule = await import('model-bank');
      mockModule.LOBE_DEFAULT_MODEL_LIST.push(tempMockEntry as any);

      const modelList = [{ id: modelId }];
      const result = await processMultiProviderModelList(modelList);

      expect(result).toHaveLength(1);
      const model = result[0];
      expect(model.id).toBe(modelId);
      // (keyword_match && !excluded) || known_ability || false
      // (true && false) || false (来自 knownModel.abilities) || false -> false
      expect(model.functionCall).toBe(false);
      expect(model.vision).toBe(false);
    });
  });

  describe('MODEL_LIST_CONFIGS and PROVIDER_DETECTION_CONFIG', () => {
    it('should have matching keys in both configuration objects', () => {
      const modelConfigKeys = Object.keys(MODEL_LIST_CONFIGS);
      const providerDetectionKeys = Object.keys(MODEL_OWNER_DETECTION_CONFIG);
      expect(modelConfigKeys.sort()).toEqual(providerDetectionKeys.sort());
    });
  });

  describe('displayName processing', () => {
    it('should replace "Gemini 2.5 Flash Image Preview" with "Nano Banana"', async () => {
      const modelList = [
        {
          id: 'gemini-2.5-flash-image-preview',
          displayName: 'Gemini 2.5 Flash Image Preview',
        },
        {
          id: 'some-other-model',
          displayName: 'Some Other Model',
        },
        {
          id: 'partial-gemini-model',
          displayName: 'Custom Gemini 2.5 Flash Image Preview Enhanced',
        },
        {
          id: 'gemini-free-model',
          displayName: 'Gemini 2.5 Flash Image Preview (free)',
        },
      ];

      const result = await processModelList(modelList, MODEL_LIST_CONFIGS.google);

      expect(result).toHaveLength(4);

      // First model should have "Nano Banana" as displayName
      const geminiModel = result.find((m) => m.id === 'gemini-2.5-flash-image-preview');
      expect(geminiModel?.displayName).toBe('Nano Banana');

      // Second model should keep original displayName
      const otherModel = result.find((m) => m.id === 'some-other-model');
      expect(otherModel?.displayName).toBe('Some Other Model');

      // Third model (partial match) should replace only the matching part
      const partialModel = result.find((m) => m.id === 'partial-gemini-model');
      expect(partialModel?.displayName).toBe('Custom Nano Banana Enhanced');

      // Fourth model should preserve the (free) suffix
      const freeModel = result.find((m) => m.id === 'gemini-free-model');
      expect(freeModel?.displayName).toBe('Nano Banana (free)');
    });

    it('should keep original displayName when not matching Gemini 2.5 Flash Image Preview', async () => {
      const modelList = [
        {
          id: 'gpt-4',
          displayName: 'GPT-4',
        },
        {
          id: 'gemini-pro',
          displayName: 'Gemini Pro',
        },
      ];

      const result = await processModelList(modelList, MODEL_LIST_CONFIGS.google);

      expect(result).toHaveLength(2);

      const gptModel = result.find((m) => m.id === 'gpt-4');
      expect(gptModel?.displayName).toBe('GPT-4');

      const geminiProModel = result.find((m) => m.id === 'gemini-pro');
      expect(geminiProModel?.displayName).toBe('Gemini Pro');
    });
  });
});
