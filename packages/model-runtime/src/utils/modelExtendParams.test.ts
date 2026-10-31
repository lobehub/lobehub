import type { LobeAgentChatConfig } from '@lobechat/types';
import type { AiModelReasoningEffortSettings } from 'model-bank/aiModel';
import { describe, expect, it } from 'vitest';

import {
  applyModelExtendParams,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveEffectiveReasoningChatConfig,
} from './modelExtendParams';

const chatConfig = (config: Partial<LobeAgentChatConfig> = {}): LobeAgentChatConfig =>
  ({ ...config }) as LobeAgentChatConfig;

const GPT_EFFORT: AiModelReasoningEffortSettings = {
  default: 'medium',
  levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};
const DEEPSEEK_EFFORT: AiModelReasoningEffortSettings = {
  controlsThinking: true,
  default: 'high',
  levels: ['none', 'low', 'high', 'max'],
};
const GLM53_EFFORT: AiModelReasoningEffortSettings = {
  controlsThinking: true,
  default: 'max',
  levels: ['low', 'high', 'max'],
};

describe('applyModelExtendParams', () => {
  it('returns empty when the model has neither extend params nor an effort control', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ enableReasoning: true, reasoningEffort: 'high' }),
        extendParams: undefined,
        model: 'gpt-4',
      }),
    ).toEqual({});
  });

  describe('reasoning effort', () => {
    // LOBE-14979: the control showed the card default while nothing was sent, so the
    // upstream ran at its own default (MiniMax M3.1 Flash: max).
    it('sends the card default when the user has not picked a level', () => {
      expect(
        applyModelExtendParams({
          chatConfig: chatConfig(),
          extendParams: [],
          model: 'MiniMax-M3.1-Flash',
          reasoningEffort: { default: 'high', levels: ['low', 'medium', 'high', 'max'] },
        }),
      ).toEqual({ reasoning_effort: 'high' });
    });

    it('sends the user pick', () => {
      expect(
        applyModelExtendParams({
          chatConfig: chatConfig({ reasoningEffort: 'max' }),
          extendParams: [],
          model: 'gpt-5.6-sol',
          reasoningEffort: GPT_EFFORT,
        }).reasoning_effort,
      ).toBe('max');
    });

    it('falls back to the card default for a pick the card no longer offers', () => {
      expect(
        applyModelExtendParams({
          chatConfig: chatConfig({ reasoningEffort: 'medium' }),
          extendParams: [],
          model: 'gemini-3-pro',
          reasoningEffort: { default: 'high', levels: ['low', 'high'] },
        }).reasoning_effort,
      ).toBe('high');
    });

    it('does not send the default when a thinking switch turned thinking off', () => {
      const result = applyModelExtendParams({
        chatConfig: chatConfig({ enableReasoning: false }),
        extendParams: ['enableReasoning'],
        model: 'hunyuan-deepseek-v4',
        reasoningEffort: DEEPSEEK_EFFORT,
      });

      expect(result.reasoning_effort).toBeUndefined();
      expect(result.thinking).toEqual({ budget_tokens: 0, type: 'disabled' });
    });
  });

  describe('effort that controls thinking', () => {
    it('maps none to disabled thinking without an effort', () => {
      const result = applyModelExtendParams({
        chatConfig: chatConfig({ reasoningEffort: 'none' }),
        extendParams: [],
        model: 'deepseek-v4-pro',
        reasoningEffort: DEEPSEEK_EFFORT,
      });

      expect(result.thinking).toEqual({ type: 'disabled' });
      expect(result.reasoning_effort).toBeUndefined();
    });

    it('maps a level to enabled thinking plus the effort', () => {
      const result = applyModelExtendParams({
        chatConfig: chatConfig({ reasoningEffort: 'low' }),
        extendParams: [],
        model: 'deepseek-v4-pro',
        reasoningEffort: DEEPSEEK_EFFORT,
      });

      expect(result).toEqual({ reasoning_effort: 'low', thinking: { type: 'enabled' } });
    });

    it('preserves the thinking budget', () => {
      const result = applyModelExtendParams({
        chatConfig: chatConfig({ reasoningBudgetToken: 2048, reasoningEffort: 'high' }),
        extendParams: ['reasoningBudgetToken'],
        model: 'deepseek-v4-pro',
        reasoningEffort: DEEPSEEK_EFFORT,
      });

      expect(result.reasoning_effort).toBe('high');
      expect(result.thinking).toEqual({ budget_tokens: 2048, type: 'enabled' });
    });

    it('keeps thinking on for a model without a none level (GLM-5.3)', () => {
      const result = applyModelExtendParams({
        chatConfig: chatConfig({ enableReasoning: false, thinking: 'disabled' }),
        extendParams: ['enableReasoning', 'thinking'],
        model: 'glm-5.3',
        reasoningEffort: GLM53_EFFORT,
      });

      expect(result.thinking).toEqual({ type: 'enabled' });
      expect(result.reasoning_effort).toBe('max');
    });
  });

  it('forwards urlContext only when enabled in the chat config', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ urlContext: true }),
        extendParams: ['urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBe(true);

    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({}),
        extendParams: ['urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBeUndefined();
  });

  it('resolves Pro mode independently from reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ reasoningEffort: 'max', reasoningMode: 'pro' }),
      extendParams: ['reasoningMode'],
      model: 'gpt-5.6-sol',
      reasoningEffort: GPT_EFFORT,
    });

    expect(result).toMatchObject({ reasoning: { mode: 'pro' }, reasoning_effort: 'max' });
  });

  it('omits the default Standard reasoning mode', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ reasoningMode: 'standard' }),
      extendParams: ['reasoningMode'],
      model: 'gpt-5.6-sol',
    });

    expect(result.reasoning).toBeUndefined();
  });

  it('omits Pro mode when the model card does not declare reasoningMode', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ reasoningMode: 'pro' }),
      extendParams: [],
      model: 'gpt-5.6-sol',
      reasoningEffort: GPT_EFFORT,
    });

    expect(result.reasoning).toBeUndefined();
  });

  it('respects Claude Sonnet 5 adaptive thinking default when unset', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['enableAdaptiveThinking'],
      model: 'claude-sonnet-5',
    });

    expect(result.thinking).toBeUndefined();
  });

  it('disables adaptive thinking only when explicitly turned off', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ enableAdaptiveThinking: false }),
      extendParams: ['enableAdaptiveThinking'],
      model: 'claude-sonnet-5',
    });

    expect(result.thinking).toEqual({ type: 'disabled' });
  });
});

describe('resolveDefaultEnableAdaptiveThinkingForModel', () => {
  it('uses per-model defaults', () => {
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-sonnet-5')).toBe(true);
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-opus-5')).toBe(true);
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-fable-5')).toBe(true);
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-opus-4-8')).toBeUndefined();
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-haiku-4-5')).toBeUndefined();
    expect(resolveDefaultEnableAdaptiveThinkingForModel('gpt-5')).toBeUndefined();
    expect(resolveDefaultEnableAdaptiveThinkingForModel()).toBeUndefined();
  });

  // The previous hard-coded id map only matched bare ids, so the same model served under a
  // provider-prefixed or dotted id silently lost its default and started with thinking off.
  it('resolves the default across provider id spellings', () => {
    expect(resolveDefaultEnableAdaptiveThinkingForModel('anthropic/claude-opus-5')).toBe(true);
    expect(resolveDefaultEnableAdaptiveThinkingForModel('global.anthropic.claude-opus-5')).toBe(
      true,
    );
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-opus-5-fast')).toBe(true);
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-sonnet-4.6')).toBeUndefined();
  });
});

describe('resolveEffectiveReasoningChatConfig', () => {
  it('should strip migrated reasoning fields from the agent chat config', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({
        reasoningEffort: 'high',
        reasoningMode: 'pro',
        textVerbosity: 'low',
        thinkingBudget: 2048,
      }),
    });

    // Legacy agent-level values must not leak into the payload path
    expect(result.reasoningEffort).toBeUndefined();
    expect(result.reasoningMode).toBeUndefined();
    // Non-migrated params stay agent-scoped
    expect(result.textVerbosity).toBe('low');
    expect(result.thinkingBudget).toBe(2048);
  });

  it('should apply model-instance defaults over the stripped agent config', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({ reasoningEffort: 'low' }),
      modelReasoningConfig: { reasoningEffort: 'xhigh', reasoningMode: 'pro' },
    });

    expect(result.reasoningEffort).toBe('xhigh');
    expect(result.reasoningMode).toBe('pro');
  });

  it('should let explicit sub-agent overrides win over model-instance defaults', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig(),
      modelReasoningConfig: { reasoningEffort: 'xhigh', reasoningMode: 'pro' },
      subAgentReasoningOverrides: { reasoningEffort: 'low' },
    });

    expect(result.reasoningEffort).toBe('low');
    // Fields the sub-agent did not set still fall back to the model-instance value
    expect(result.reasoningMode).toBe('pro');
  });

  it('should ignore non-reasoning fields smuggled into the override objects', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({ textVerbosity: 'high' }),
      modelReasoningConfig: { textVerbosity: 'low' } as never,
    });

    expect(result.textVerbosity).toBe('high');
  });

  it('should produce the same extend params on both runtimes for a stale agent value', () => {
    const effective = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({ reasoningEffort: 'low' }),
      modelReasoningConfig: { reasoningEffort: 'max' },
    });

    const params = applyModelExtendParams({
      chatConfig: effective,
      extendParams: ['reasoningMode', 'textVerbosity'],
      model: 'gpt-5.6-sol',
      reasoningEffort: GPT_EFFORT,
    });

    expect(params.reasoning_effort).toBe('max');
  });
});
