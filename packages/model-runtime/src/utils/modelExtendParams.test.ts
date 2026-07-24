import type { LobeAgentChatConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  applyModelExtendParams,
  resolveDefaultEnableAdaptiveThinkingForModel,
  resolveDefaultThinkingLevelForModel,
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

  it('defaults Gemini 3.6 Flash thinkingLevel to medium', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel'],
      model: 'gemini-3.6-flash',
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
    expect(resolveDefaultEnableAdaptiveThinkingForModel('claude-opus-4-8')).toBeUndefined();
  });
});

describe('resolveDefaultThinkingLevelForModel', () => {
  it('falls back to high without a model', () => {
    expect(resolveDefaultThinkingLevelForModel()).toBe('high');
  });

  it('uses per-model defaults', () => {
    expect(resolveDefaultThinkingLevelForModel('gemini-3.5-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.5-flash-lite')).toBe('minimal');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.1-flash-lite')).toBe('minimal');
  });
});
