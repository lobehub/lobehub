import type { LobeAgentChatConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  applyModelExtendParams,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
  resolveEffectiveReasoningChatConfig,
} from './modelExtendParams';

const chatConfig = (config: Partial<LobeAgentChatConfig> = {}): LobeAgentChatConfig =>
  ({ ...config }) as LobeAgentChatConfig;

describe('applyModelExtendParams', () => {
  it('returns empty when the model has no extend params', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ enableReasoning: true }),
        extendParams: undefined,
        model: 'gpt-4',
      }),
    ).toEqual({});

    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ thinkingLevel3: 'high' }),
        extendParams: [],
        model: 'gemini-3.1-pro-preview',
      }),
    ).toEqual({});
  });

  // Gemini 3 Pro via the agent path (provider=lobehub) billed reasoning tokens but
  // returned empty thinking summaries because thinkingLevel never reached the
  // request. With the model's extendParams present, thinkingLevel must default
  // to 'high' even when the chat config does not set thinkingLevel3.
  it('defaults thinkingLevel to high for gemini-3.1-pro-preview (thinkingLevel3)', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.1-pro-preview',
    });

    expect(result.thinkingLevel).toBe('high');
  });

  it('honors an explicit thinkingLevel3 config value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel3: 'medium' }),
      extendParams: ['thinkingLevel3'],
      model: 'gemini-3.1-pro-preview',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('defaults Gemini 3.7 Flash thinkingLevel to medium (thinkingLevel3)', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.7-flash',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('defaults Gemini 3.8 Flash thinkingLevel to medium (thinkingLevel3)', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.8-flash',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('honors an explicit Gemini 3.8 Flash thinkingLevel3 value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel3: 'low' }),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.8-flash',
    });

    expect(result.thinkingLevel).toBe('low');
  });

  it('honors an explicit Gemini 3.7 Flash thinkingLevel3 value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel3: 'high' }),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.7-flash',
    });

    expect(result.thinkingLevel).toBe('high');
  });

  it('defaults Gemini 3.6 Flash thinkingLevel to medium', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel'],
      model: 'gemini-3.6-flash',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('defaults Gemini 3.7 Flash thinkingLevel to medium (thinkingLevel3, no minimal)', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.7-flash',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('honors an explicit Gemini 3.6 Flash thinkingLevel value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel: 'low' }),
      extendParams: ['thinkingLevel'],
      model: 'gemini-3.6-flash',
    });

    expect(result.thinkingLevel).toBe('low');
  });

  it('defaults Gemini 3.5 Flash-Lite thinkingLevel to minimal', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel'],
      model: 'gemini-3.5-flash-lite',
    });

    expect(result.thinkingLevel).toBe('minimal');
  });

  it('honors an explicit Gemini 3.5 Flash-Lite thinkingLevel value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel: 'high' }),
      extendParams: ['thinkingLevel'],
      model: 'gemini-3.5-flash-lite',
    });

    expect(result.thinkingLevel).toBe('high');
  });

  it('forwards urlContext only when enabled in the chat config', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ urlContext: true }),
        extendParams: ['thinkingLevel3', 'urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBe(true);

    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({}),
        extendParams: ['thinkingLevel3', 'urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBeUndefined();
  });

  it('resolves reasoning effort variants', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ reasoningEffort: 'high' }),
        extendParams: ['reasoningEffort'],
        model: 'some-model',
      }).reasoning_effort,
    ).toBe('high');
  });

  it('resolves GPT-5.6 max reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ gpt5_6ReasoningEffort: 'max' }),
      extendParams: ['gpt5_6ReasoningEffort'],
      model: 'gpt-5.6-sol',
    });

    expect(result.reasoning_effort).toBe('max');
  });

  it('resolves GPT-6 xhigh reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ gpt6ReasoningEffort: 'xhigh' }),
      extendParams: ['gpt6ReasoningEffort'],
      model: 'gpt-6-astra',
    });

    expect(result.reasoning_effort).toBe('xhigh');
  });

  it('resolves Kimi K3 reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ kimiK3ReasoningEffort: 'high' }),
      extendParams: ['kimiK3ReasoningEffort'],
      model: 'kimi-k3',
    });

    expect(result.reasoning_effort).toBe('high');
  });

  it('resolves Grok 4.6 xhigh reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ grok4_6ReasoningEffort: 'xhigh' }),
      extendParams: ['grok4_6ReasoningEffort'],
      model: 'grok-4.6',
    });

    expect(result.reasoning_effort).toBe('xhigh');
  });

  it('resolves GPT-5.6 Pro mode independently from reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        gpt5_6ReasoningEffort: 'max',
        reasoningMode: 'pro',
      }),
      extendParams: ['reasoningMode', 'gpt5_6ReasoningEffort'],
      model: 'gpt-5.6-sol',
    });

    expect(result).toMatchObject({
      reasoning: { mode: 'pro' },
      reasoning_effort: 'max',
    });
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
      extendParams: ['gpt5_6ReasoningEffort'],
      model: 'gpt-5.6-sol',
    });

    expect(result.reasoning).toBeUndefined();
  });

  it('resolves GLM-5.2 reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ glm5_2ReasoningEffort: 'max' }),
      extendParams: ['glm5_2ReasoningEffort'],
      model: 'glm-5.2',
    });

    expect(result.reasoning_effort).toBe('max');
  });

  it('forces thinking enabled and resolves GLM-5.3 reasoning effort', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ enableReasoning: false, glm5_3ReasoningEffort: 'low' }),
      extendParams: ['glm5_3ReasoningEffort'],
      model: 'glm-5.3',
    });

    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.reasoning_effort).toBe('low');
  });

  it('keeps GLM-5.3 thinking enabled when a custom card also lists thinking=disabled', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ glm5_3ReasoningEffort: 'max', thinking: 'disabled' }),
      extendParams: ['glm5_3ReasoningEffort', 'thinking'],
      model: 'glm-5.3',
    });

    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.reasoning_effort).toBe('max');
  });

  it('preserves thinking budget when deepseekV4ReasoningEffort is set', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        deepseekV4ReasoningEffort: 'high',
        reasoningBudgetToken: 2048,
      }),
      extendParams: ['deepseekV4ReasoningEffort', 'reasoningBudgetToken'],
      model: 'deepseek-v4-pro',
    });

    expect(result.reasoning_effort).toBe('high');
    expect(result.thinking).toEqual({
      budget_tokens: 2048,
      type: 'enabled',
    });
  });

  it('enables thinking and sets reasoning_effort for deepseekV4GAReasoningEffort low', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        deepseekV4GAReasoningEffort: 'low',
      }),
      extendParams: ['deepseekV4GAReasoningEffort'],
      model: 'deepseek-v4-flash',
    });

    expect(result.reasoning_effort).toBe('low');
    expect(result.thinking).toEqual({
      type: 'enabled',
    });
  });

  it('disables thinking when deepseekV4GAReasoningEffort is none', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        deepseekV4GAReasoningEffort: 'none',
      }),
      extendParams: ['deepseekV4GAReasoningEffort'],
      model: 'deepseek-v4-flash',
    });

    expect(result.reasoning_effort).toBeUndefined();
    expect(result.thinking).toEqual({
      type: 'disabled',
    });
  });

  it('prefers deepseekV4GAReasoningEffort when both DeepSeek V4 params are declared', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        deepseekV4GAReasoningEffort: 'low',
        deepseekV4ReasoningEffort: 'max',
      }),
      extendParams: ['deepseekV4GAReasoningEffort', 'deepseekV4ReasoningEffort'],
      model: 'deepseek-v4-flash',
    });

    expect(result.reasoning_effort).toBe('low');
    expect(result.thinking).toEqual({
      type: 'enabled',
    });
  });

  /**
   * Official DeepSeek 400s only when a thinking-mode tool-call turn omits the
   * thinking block entirely. A leftover preview `none` on a GA-only card must
   * not flip thinking to disabled — the payload builder then keeps the
   * whitespace placeholder instead of dropping the field.
   */
  it('ignores leftover preview none when the card only declares the GA effort param', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ deepseekV4ReasoningEffort: 'none' }),
      extendParams: ['deepseekV4GAReasoningEffort'],
      model: 'deepseek-v4-flash',
    });

    expect(result.thinking).toBeUndefined();
    expect(result.reasoning_effort).toBeUndefined();
  });

  it('keeps GA thinking on when leftover preview none is stored beside a GA high', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({
        deepseekV4GAReasoningEffort: 'high',
        deepseekV4ReasoningEffort: 'none',
      }),
      extendParams: ['deepseekV4GAReasoningEffort'],
      model: 'deepseek-v4-flash',
    });

    expect(result.reasoning_effort).toBe('high');
    expect(result.thinking).toEqual({ type: 'enabled' });
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

describe('resolveDefaultThinkingLevelForModel', () => {
  it('falls back to high without a model', () => {
    expect(resolveDefaultThinkingLevelForModel()).toBe('high');
    expect(resolveDefaultThinkingLevelForModel(undefined, 'thinkingLevel3')).toBe('high');
    expect(resolveDefaultThinkingLevelForModel(undefined, 'thinkingLevel4')).toBe('minimal');
  });

  it('uses per-model defaults', () => {
    expect(resolveDefaultThinkingLevelForModel('gemini-flash-latest')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-flash-latest', 'thinkingLevel3')).toBe(
      'medium',
    );
    expect(resolveDefaultThinkingLevelForModel('gemini-3.7-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.7-flash', 'thinkingLevel3')).toBe(
      'medium',
    );
    expect(resolveDefaultThinkingLevelForModel('gemini-3.8-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.8-flash', 'thinkingLevel3')).toBe(
      'medium',
    );
    expect(resolveDefaultThinkingLevelForModel('gemini-flash-lite-latest')).toBe('minimal');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.6-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.7-flash', 'thinkingLevel3')).toBe(
      'medium',
    );
    expect(resolveDefaultThinkingLevelForModel('gemini-3.5-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.5-flash-lite')).toBe('minimal');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.1-flash-lite')).toBe('minimal');
  });
});

describe('resolveEffectiveReasoningChatConfig', () => {
  it('should strip migrated reasoning fields from the agent chat config', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({
        gpt5_6ReasoningEffort: 'max',
        reasoningEffort: 'high',
        reasoningMode: 'pro',
        textVerbosity: 'low',
        thinkingBudget: 2048,
      }),
    });

    // Legacy agent-level values must not leak into the payload path
    expect(result.gpt5_6ReasoningEffort).toBeUndefined();
    expect(result.reasoningEffort).toBeUndefined();
    expect(result.reasoningMode).toBeUndefined();
    // Non-migrated params stay agent-scoped
    expect(result.textVerbosity).toBe('low');
    expect(result.thinkingBudget).toBe(2048);
  });

  it('should apply model-instance defaults over the stripped agent config', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig({ gpt5_6ReasoningEffort: 'low' }),
      modelReasoningConfig: { gpt5_6ReasoningEffort: 'xhigh', reasoningMode: 'pro' },
    });

    expect(result.gpt5_6ReasoningEffort).toBe('xhigh');
    expect(result.reasoningMode).toBe('pro');
  });

  it('should let explicit sub-agent overrides win over model-instance defaults', () => {
    const result = resolveEffectiveReasoningChatConfig({
      agentChatConfig: chatConfig(),
      modelReasoningConfig: { gpt5_6ReasoningEffort: 'xhigh', reasoningMode: 'pro' },
      subAgentReasoningOverrides: { gpt5_6ReasoningEffort: 'low' },
    });

    expect(result.gpt5_6ReasoningEffort).toBe('low');
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
      agentChatConfig: chatConfig({ gpt5_6ReasoningEffort: 'low' }),
      modelReasoningConfig: { gpt5_6ReasoningEffort: 'max' },
    });

    const params = applyModelExtendParams({
      chatConfig: effective,
      extendParams: ['reasoningMode', 'gpt5_6ReasoningEffort', 'textVerbosity'],
      model: 'gpt-5.6-sol',
    });

    expect(params.reasoning_effort).toBe('max');
  });
});
