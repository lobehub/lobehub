import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as aiInfraStore from '@/store/aiInfra';
import * as aiModelSelectors from '@/store/aiInfra/slices/aiModel/selectors';

import { resolveModelExtendParams } from './modelParamsResolver';

describe('resolveModelExtendParams', () => {
  const mockAiInfraStoreState = { someState: true };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(aiInfraStore, 'getAiInfraStoreState').mockReturnValue(mockAiInfraStoreState as any);
  });

  describe('when model has no extend params', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => false,
      );
    });

    it('should return empty object when model has no extend params support', () => {
      const result = resolveModelExtendParams({
        chatConfig: { enableReasoning: true } as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toEqual({});
    });

    it('should return empty object even if chatConfig has extended params configured', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          disableContextCaching: true,
          enableReasoning: true,
          reasoningBudgetToken: 2048,
          reasoningEffort: 'high',
        } as any,
        model: 'basic-model',
        provider: 'provider',
      });

      expect(result).toEqual({});
    });
  });

  describe('when model has extend params but no modelExtendParams available', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(
        () => undefined,
      );
    });

    it('should return empty object when modelExtendParams is undefined', () => {
      const result = resolveModelExtendParams({
        chatConfig: { enableReasoning: true } as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toEqual({});
    });
  });

  describe('reasoning configuration', () => {
    describe('enableReasoning param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'enableReasoning',
        ]);
      });

      it('should set thinking to enabled with budget when enableReasoning is true', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            enableReasoning: true,
            reasoningBudgetToken: 2048,
          } as any,
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.thinking).toEqual({
          budget_tokens: 2048,
          type: 'enabled',
        });
      });

      it('should use default budget token when not specified', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            enableReasoning: true,
          } as any,
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.thinking).toEqual({
          budget_tokens: 1024,
          type: 'enabled',
        });
      });

      it('should set thinking to disabled when enableReasoning is false', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            enableReasoning: false,
          } as any,
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.thinking).toEqual({
          budget_tokens: 0,
          type: 'disabled',
        });
      });
    });

    describe('reasoningBudgetToken only param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'reasoningBudgetToken',
        ]);
      });

      it('should set thinking to enabled when only reasoningBudgetToken is supported', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            reasoningBudgetToken: 4096,
          } as any,
          model: 'claude-3',
          provider: 'anthropic',
        });

        expect(result.thinking).toEqual({
          budget_tokens: 4096,
          type: 'enabled',
        });
      });

      it('should use default budget when reasoningBudgetToken is not provided', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'claude-3',
          provider: 'anthropic',
        });

        expect(result.thinking).toEqual({
          budget_tokens: 1024,
          type: 'enabled',
        });
      });
    });
  });

  describe('context caching', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'disableContextCaching',
      ]);
    });

    it('should set enabledContextCaching to false when disableContextCaching is true', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          disableContextCaching: true,
        } as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledContextCaching).toBe(false);
    });

    it('should not set enabledContextCaching when disableContextCaching is false', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          disableContextCaching: false,
        } as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledContextCaching).toBeUndefined();
    });

    it('should not set enabledContextCaching when disableContextCaching is not provided', () => {
      const result = resolveModelExtendParams({
        chatConfig: {} as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledContextCaching).toBeUndefined();
    });
  });

  describe('reasoning effort variants', () => {
    describe('reasoningEffort param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'reasoningEffort',
        ]);
      });

      it('should set reasoning_effort when supported and configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            reasoningEffort: 'medium',
          } as any,
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBe('medium');
      });

      it('should not set reasoning_effort when not configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBeUndefined();
      });
    });

    describe('gpt5ReasoningEffort param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'gpt5ReasoningEffort',
        ]);
      });

      it('should set reasoning_effort for gpt5 variant', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            gpt5ReasoningEffort: 'high',
          } as any,
          model: 'gpt-5',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBe('high');
      });
    });

    describe('gpt5_1ReasoningEffort param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'gpt5_1ReasoningEffort',
        ]);
      });

      it('should set reasoning_effort for gpt5.1 variant', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            gpt5_1ReasoningEffort: 'low',
          } as any,
          model: 'gpt-5.1',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBe('low');
      });
    });

    describe('gpt5_2ReasoningEffort param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'gpt5_2ReasoningEffort',
        ]);
      });

      it('should set reasoning_effort for gpt5.2 variant', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            gpt5_2ReasoningEffort: 'medium',
          } as any,
          model: 'gpt-5.2',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBe('medium');
      });
    });

    describe('gpt5_2ProReasoningEffort param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'gpt5_2ProReasoningEffort',
        ]);
      });

      it('should set reasoning_effort for gpt5.2-pro variant', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            gpt5_2ProReasoningEffort: 'high',
          } as any,
          model: 'gpt-5.2-pro',
          provider: 'openai',
        });

        expect(result.reasoning_effort).toBe('high');
      });
    });
  });

  describe('text verbosity', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'textVerbosity',
      ]);
    });

    it('should set verbosity when textVerbosity is supported and configured', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          textVerbosity: 'detailed',
        } as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result.verbosity).toBe('detailed');
    });

    it('should not set verbosity when textVerbosity is not configured', () => {
      const result = resolveModelExtendParams({
        chatConfig: {} as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result.verbosity).toBeUndefined();
    });
  });

  describe('thinking configuration', () => {
    describe('thinking param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'thinking',
        ]);
      });

      it('should set thinking type when supported and configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            thinking: 'extended',
          } as any,
          model: 'deepseek',
          provider: 'deepseek',
        });

        expect(result.thinking).toEqual({
          type: 'extended',
        });
      });

      it('should not set thinking when not configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'deepseek',
          provider: 'deepseek',
        });

        expect(result.thinking).toBeUndefined();
      });
    });

    describe('thinkingBudget param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'thinkingBudget',
        ]);
      });

      it('should set thinkingBudget when supported and configured with value', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            thinkingBudget: 5000,
          } as any,
          model: 'model',
          provider: 'provider',
        });

        expect(result.thinkingBudget).toBe(5000);
      });

      it('should set thinkingBudget to 0 when explicitly set to 0', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            thinkingBudget: 0,
          } as any,
          model: 'model',
          provider: 'provider',
        });

        expect(result.thinkingBudget).toBe(0);
      });

      it('should not set thinkingBudget when undefined', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'model',
          provider: 'provider',
        });

        expect(result.thinkingBudget).toBeUndefined();
      });
    });

    describe('thinkingLevel param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'thinkingLevel',
        ]);
      });

      it('should set thinkingLevel when supported and configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            thinkingLevel: 'advanced',
          } as any,
          model: 'model',
          provider: 'provider',
        });

        expect(result.thinkingLevel).toBe('advanced');
      });

      it('should not set thinkingLevel when not configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'model',
          provider: 'provider',
        });

        expect(result.thinkingLevel).toBeUndefined();
      });
    });
  });

  describe('URL context', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'urlContext',
      ]);
    });

    it('should set urlContext when supported and enabled', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          urlContext: true,
        } as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result.urlContext).toBe(true);
    });

    it('should not set urlContext when false', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          urlContext: false,
        } as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result.urlContext).toBeUndefined();
    });

    it('should not set urlContext when not configured', () => {
      const result = resolveModelExtendParams({
        chatConfig: {} as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result.urlContext).toBeUndefined();
    });
  });

  describe('image generation params', () => {
    describe('imageAspectRatio param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'imageAspectRatio',
        ]);
      });

      it('should set imageAspectRatio when supported and configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            imageAspectRatio: '16:9',
          } as any,
          model: 'dall-e-3',
          provider: 'openai',
        });

        expect(result.imageAspectRatio).toBe('16:9');
      });

      it('should not set imageAspectRatio when not configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'dall-e-3',
          provider: 'openai',
        });

        expect(result.imageAspectRatio).toBeUndefined();
      });
    });

    describe('imageResolution param', () => {
      beforeEach(() => {
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
          () => true,
        );
        vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
          'imageResolution',
        ]);
      });

      it('should set imageResolution when supported and configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {
            imageResolution: '1024x1024',
          } as any,
          model: 'dall-e-3',
          provider: 'openai',
        });

        expect(result.imageResolution).toBe('1024x1024');
      });

      it('should not set imageResolution when not configured', () => {
        const result = resolveModelExtendParams({
          chatConfig: {} as any,
          model: 'dall-e-3',
          provider: 'openai',
        });

        expect(result.imageResolution).toBeUndefined();
      });
    });
  });

  describe('multiple params combination', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
    });

    it('should handle multiple params together correctly', () => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'enableReasoning',
        'reasoningEffort',
        'textVerbosity',
        'urlContext',
        'disableContextCaching',
      ]);

      const result = resolveModelExtendParams({
        chatConfig: {
          disableContextCaching: true,
          enableReasoning: true,
          reasoningBudgetToken: 3072,
          reasoningEffort: 'high',
          textVerbosity: 'concise',
          urlContext: true,
        } as any,
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toEqual({
        enabledContextCaching: false,
        reasoning_effort: 'high',
        thinking: {
          budget_tokens: 3072,
          type: 'enabled',
        },
        urlContext: true,
        verbosity: 'concise',
      });
    });

    it('should only set params that are both supported and configured', () => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'enableReasoning',
        'textVerbosity',
      ]);

      const result = resolveModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          imageAspectRatio: '1:1', // Not supported
          reasoningBudgetToken: 2048,
          textVerbosity: 'detailed',
          urlContext: true, // Not supported
        } as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result).toEqual({
        thinking: {
          budget_tokens: 2048,
          type: 'enabled',
        },
        verbosity: 'detailed',
      });
      expect(result.imageAspectRatio).toBeUndefined();
      expect(result.urlContext).toBeUndefined();
    });

    it('should handle image generation params together', () => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'imageAspectRatio',
        'imageResolution',
      ]);

      const result = resolveModelExtendParams({
        chatConfig: {
          imageAspectRatio: '4:3',
          imageResolution: '2048x2048',
        } as any,
        model: 'dall-e-3',
        provider: 'openai',
      });

      expect(result).toEqual({
        imageAspectRatio: '4:3',
        imageResolution: '2048x2048',
      });
    });

    it('should handle all thinking-related params together', () => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'thinking',
        'thinkingBudget',
        'thinkingLevel',
      ]);

      const result = resolveModelExtendParams({
        chatConfig: {
          thinking: 'enabled',
          thinkingBudget: 8000,
          thinkingLevel: 'expert',
        } as any,
        model: 'deepseek',
        provider: 'deepseek',
      });

      expect(result).toEqual({
        thinking: {
          type: 'enabled',
        },
        thinkingBudget: 8000,
        thinkingLevel: 'expert',
      });
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(
        () => true,
      );
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => [
        'enableReasoning',
        'textVerbosity',
        'urlContext',
        'thinkingBudget',
      ]);
    });

    it('should handle empty chatConfig', () => {
      const result = resolveModelExtendParams({
        chatConfig: {} as any,
        model: 'model',
        provider: 'provider',
      });

      // enableReasoning defaults to false/undefined, so thinking is set to disabled
      expect(result.thinking).toEqual({
        budget_tokens: 0,
        type: 'disabled',
      });
      expect(result.verbosity).toBeUndefined();
      expect(result.urlContext).toBeUndefined();
      expect(result.thinkingBudget).toBeUndefined();
    });

    it('should handle null/undefined chatConfig values gracefully', () => {
      const result = resolveModelExtendParams({
        chatConfig: {
          enableReasoning: undefined,
          textVerbosity: null as any,
          urlContext: undefined,
        } as any,
        model: 'model',
        provider: 'provider',
      });

      // enableReasoning is undefined (falsy), so thinking is set to disabled
      expect(result).toEqual({
        thinking: {
          budget_tokens: 0,
          type: 'disabled',
        },
      });
    });

    it('should handle empty modelExtendParams array', () => {
      vi.spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);

      const result = resolveModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          textVerbosity: 'detailed',
        } as any,
        model: 'model',
        provider: 'provider',
      });

      expect(result).toEqual({});
    });

    it('should verify selectors are called with correct parameters', () => {
      const isModelHasExtendParamsSpy = vi
        .spyOn(aiModelSelectors.aiModelSelectors, 'isModelHasExtendParams')
        .mockReturnValue(() => true);
      const modelExtendParamsSpy = vi
        .spyOn(aiModelSelectors.aiModelSelectors, 'modelExtendParams')
        .mockReturnValue(() => ['enableReasoning']);

      resolveModelExtendParams({
        chatConfig: {} as any,
        model: 'test-model',
        provider: 'test-provider',
      });

      expect(isModelHasExtendParamsSpy).toHaveBeenCalledWith('test-model', 'test-provider');
      expect(modelExtendParamsSpy).toHaveBeenCalledWith('test-model', 'test-provider');
    });
  });
});
